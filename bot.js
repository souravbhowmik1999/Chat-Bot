const { Telegraf, session } = require('telegraf');
const { google } = require('googleapis');
require('dotenv').config(); // Load environment variables from .env file
const { transcribeAudio } = require('./api');
const fs = require('fs');
const axios = require('axios');

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_AUTH_KEY_FILE,
  scopes: [process.env.GOOGLE_AUTH_SCOPES],
});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Apply the session middleware
bot.use(session());

// Initialize session variables for each user
bot.use((ctx, next) => {
  try {
    // Check if ctx.session is not defined
    if (!ctx.session) {
      ctx.session = {};
    }

    ctx.session.currentQuestionIndex = ctx.session.currentQuestionIndex || 0;
    ctx.session.currentAnsIndex = ctx.session.currentAnsIndex || 2;

  } catch (error) {
    console.error('Error initializing session:', error.message);
  }
  return next();
});

bot.start((ctx) => {
  try {
    ctx.reply('Welcome! I will ask you a series of questions. Type /next to begin.');
  } catch (error) {
    console.error('Error processing /start command:', error.message);
  }
});

bot.command('next', async (ctx) => {
  try {
    const NumberOfQuestion = await countQuestion();

    if (NumberOfQuestion == ctx.session.currentQuestionIndex) {
      ctx.session.currentQuestionIndex = 0;
    }

    // Fetch the next question from the Google Sheets
    const question = await fetchQuestion(ctx.session.currentQuestionIndex);

    // Ask the question to the user
    ctx.reply(question.question);
  } catch (error) {
    console.error('Error fetching or processing the next question:', error.message);
    ctx.reply('Error fetching the next question. Please try again later.');
  }
});

bot.on('text', async (ctx) => {
  try {
    const NumberOfQuestion = await countQuestion();

    // Update the Google Sheets with the user's response
    await updateSheet(ctx.session.currentQuestionIndex, ctx.session.currentAnsIndex, ctx.message.text);

    // Increment the question index
    ctx.session.currentQuestionIndex++;

    if (ctx.session.currentQuestionIndex == NumberOfQuestion) {
      await ctx.reply('Form fillup successfully');
      await ctx.reply('You have completed the form. Type /start to submit again.');
      return;
    } else {
      // Fetch the next question from the Google Sheets
      const question = await fetchQuestion(ctx.session.currentQuestionIndex);

      // Ask the next question
      ctx.reply(question.question);
    }
  } catch (error) {
    console.error('Error processing user response:', error.message);
    ctx.reply('Error processing your response. Please try again.');
  }
});

//GET and store audio file 
bot.on('voice', async (ctx) => {
  const NumberOfQuestion = await countQuestion();
  const voiceFileId = ctx.message.voice.file_id;
  const fileType = ctx.message.voice.mime_type;

  // Check if the voice message contains audio data
  if (voiceFileId) {
    const voiceFilePath = `./audio/${voiceFileId}.oga`;
    const fileLink = await ctx.telegram.getFileLink(voiceFileId);

    // Download the file using axios
    const response = await axios({
      method: 'GET',
      url: fileLink,
      responseType: 'stream',
    });

    // Save the file
    const fileStream = fs.createWriteStream(voiceFilePath);
    response.data.pipe(fileStream);

    // Wait for the file to be saved
    await new Promise((resolve) => fileStream.on('finish', resolve));

    // Transcribe audio and handle the result
    await handleTranscription(ctx, voiceFilePath, NumberOfQuestion);
  }
});

//Audio file to text convertion
async function handleTranscription(ctx, voiceFilePath, NumberOfQuestion) {
  const audioContent = fs.readFileSync(voiceFilePath, { encoding: 'base64' });

  // Transcribe audio
  const responseAudio = await transcribeAudio(audioContent);
  const message = responseAudio.data.output[0].source;

  // Update sheet and perform other actions with the transcription result
  await updateSheet(ctx.session.currentQuestionIndex, ctx.session.currentAnsIndex, message);
  ctx.session.currentQuestionIndex++;

  if (ctx.session.currentQuestionIndex === NumberOfQuestion) {
    await ctx.reply('Form fillup successfully');
    await ctx.reply('You have completed the form. Type /start to submit again.');
    return;
  } else {
    const question = await fetchQuestion(ctx.session.currentQuestionIndex);
    ctx.reply(question.question);
  }
}




async function countQuestion() {
  const sheetsAPI = google.sheets('v4');

  const response = await sheetsAPI.spreadsheets.values.get({
    auth,
    spreadsheetId: process.env.GOOGLE_SPREAD_SHEET_ID,
    range: `Form Responses 1!A1:Z1`,
  });

  // Get all questions from the google sheet
  const valuesArray = response.data.values[0];

  // Fetch the number of questions in the google sheet
  const count = valuesArray.length;

  return count;
}

async function fetchQuestion(index) {
  try {

    const sheetsAPI = google.sheets('v4');

    const response = await sheetsAPI.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SPREAD_SHEET_ID,
      range: `Form Responses 1!A1:Z1`,
    });

    const valuesArray = response.data.values[0];

    const question = valuesArray[index];

    if (!question || question.trim() === '') {
      throw new Error('Empty question received from Google Sheets.');
    }
    const count = valuesArray.length;

    console.log('Question fetched successfully:', question);

    return { question, count };
  } catch (error) {
    console.error('Error fetching question from Google Sheets:', error.message);
    throw error;
  }
}

async function updateSheet(currentQuestionIndex, currentAnsIndex, response) {
  try {
    const sheetsAPI = google.sheets('v4');

    const columnLetter = String.fromCharCode('A'.charCodeAt(0) + currentQuestionIndex);
    const range = `Form Responses 1!${columnLetter}${currentAnsIndex}`;

    // Check if the cell is blank
    const checkBlankResponse = await sheetsAPI.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SPREAD_SHEET_ID,
      range,
    });

    const isCellBlank = !checkBlankResponse.data.values || !checkBlankResponse.data.values[0] || checkBlankResponse.data.values[0][0] === '';

    if (isCellBlank) {
      // If the cell is blank, write the transcribed text
      await sheetsAPI.spreadsheets.values.update({
        auth,
        spreadsheetId: process.env.GOOGLE_SPREAD_SHEET_ID,
        range,
        valueInputOption: 'RAW',
        resource: {
          values: [[response]],
        },
      });
    } else {
      // If the cell is not blank, find the next empty row in the column
      const nextEmptyRowResponse = await sheetsAPI.spreadsheets.values.get({
        auth,
        spreadsheetId: process.env.GOOGLE_SPREAD_SHEET_ID,
        range: `Form Responses 1!${columnLetter}:${columnLetter}`,
      });

      const nextEmptyRow = nextEmptyRowResponse.data.values ? nextEmptyRowResponse.data.values.length + 1 : 1;

      // Update the transcribed text in the next empty row
      await sheetsAPI.spreadsheets.values.update({
        auth,
        spreadsheetId: process.env.GOOGLE_SPREAD_SHEET_ID,
        range: `Form Responses 1!${columnLetter}${nextEmptyRow}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[response]],
        },
      });
    }

    console.log('Google Sheets updated successfully.');
  } catch (error) {
    console.error('Error updating Google Sheets:', error.message);
    throw error;
  }
}

bot.launch({ polling: { debug: true } }).then(() => {
  console.log('Bot is running');
});

