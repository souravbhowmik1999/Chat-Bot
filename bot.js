const { Telegraf, session } = require('telegraf');
const { Markup } = require('telegraf');
const { google } = require('googleapis');
require('dotenv').config(); // Load environment variables from .env file
const { transcribeAudio } = require('./api');
const { textToAudio } = require('./api');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

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

bot.start(async (ctx) => {
  try {
    const formattedResponse = "<b>What can this bot do?</b>\n\nI am a bot designed to help you in your journey to land your dream job!";
    ctx.replyWithHTML(formattedResponse);

    // Ask the user to choose a language
    const languageData = await fetchLanguage(ctx);

  } catch (error) {
    console.error('Error processing /start command:', error.message);
  }
});

async function fetchLanguage(ctx) {

// Send a message with language selection buttons
return ctx.reply('Please select your language:', Markup.inlineKeyboard([
  Markup.button.callback('English', 'selectLanguage_en'),
  Markup.button.callback('हिंदी', 'selectLanguage_hi'),
  // Markup.button.callback('मराठी', 'selectLanguage_mr'),
  // Add more language buttons as needed
]));

}
bot.action('selectLanguage_en', (ctx) => {
  ctx.session.language = 'en';
  ctx.reply('You selected English. You can start your conversation now.');
});

bot.action('selectLanguage_hi', (ctx) => {
  ctx.session.language = 'hi';
  ctx.reply('आपने हिंदी का चयन किया। अब आप अपनी बातचीत शुरू कर सकते हैं।');
});
// You can add more logic here for handling language options


bot.command('next', async (ctx) => {
  try {
    const NumberOfQuestion = await countQuestion();

    if (NumberOfQuestion == ctx.session.currentQuestionIndex) {
      ctx.session.currentQuestionIndex = 0;
    }

    // Fetch the next question from the Google Sheets
    const question = await fetchQuestion(ctx.session.currentQuestionIndex);

    await getNextQuestion(ctx,question)

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
     await getNextQuestion(ctx,question)
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
   await getNextQuestion(ctx,question)
  }
}


async function getNextQuestion(ctx,question){
  // Ask the question to the user in audio format
  await ctx.replyWithAudio({ source: question.filePath });
  // Ask the question to the user in text format
  ctx.reply(question.question);
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
    const directoryPath = './audio/question';  
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

    //Generate File name
    let audioQuestion = question.replace(/\s+/g, '-').toLowerCase();

    //Directory File Read
    const files = await fs.promises.readdir(directoryPath);

    // Filter files based on the naming pattern
    const searchString = audioQuestion;
    let matchingFiles = files.filter(file => file.includes(searchString));

    let filePath;
    if(matchingFiles.length > 0){
      filePath = path.join(__dirname, 'audio/question', matchingFiles[0]);
    }else{

      // Assuming textToAudio is an asynchronous function that returns an object with audioContent
      const audioResponse = await textToAudio(question);

      // Extract the audio content
      const audioContent = audioResponse.data.audio[0].audioContent;
      
      // Create a unique filename for the audio file
      const filename = `${audioQuestion}_${Date.now()}.wav`;

      // Define the path to the 'audio' folder
      filePath = path.join(__dirname, 'audio/question', filename);

      // Convert base64 audio content to binary buffer
      const audioBuffer = Buffer.from(audioContent, 'base64');

      // Write the audio buffer to the file
      fs.writeFileSync(filePath, audioBuffer);

      console.log(`Audio saved to: ${filePath}`);
    }

    return { question, count, filePath };
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

