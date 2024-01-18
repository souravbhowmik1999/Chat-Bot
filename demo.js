const { Telegraf, session } = require('telegraf');
const { google } = require('googleapis');
const record = require('node-record-lpcm16');
const speech = require('@google-cloud/speech');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const axios = require('axios');

const auth = new google.auth.GoogleAuth({
  keyFile: '/home/ttpl-rt-113/Desktop/telepgramapp/stalwart-veld-411410-5d8032822350.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const bot = new Telegraf('6506253291:AAGMNqr-H1HGpCfSUVt3KqpTh9HiOhIU1DU');
const storage = new Storage();

// Initialize the Google Cloud Speech client
const speechClient = new speech.SpeechClient();


// Initialize session variables for each user
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
    console.log('Session initialized:', ctx.session);
  } catch (error) {
    console.error('Error initializing session:', error.message);
  }
  return next();
});

bot.start((ctx) => {
  try {
    console.log('Start command received. Session:', ctx.session);
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

// Handle voice messages
bot.on('voice', async (ctx) => {
  try {
    // Download the voice message file
    const voiceFileId = ctx.message.voice.file_id;
    const voiceFilePath = `./audio/${voiceFileId}.oga`;

    // Get a direct link to the file
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

    // Convert the OGG file to WAV format (required by the Speech-to-Text API)
    const wavFilePath = `/path/to/your/audio/${voiceFileId}.wav`;
    await convertOggToWav(voiceFilePath, wavFilePath);

    // Transcribe the voice message
    const transcription = await transcribeVoice(wavFilePath);

    // Update the Google Sheets with the transcribed text
    await updateSheet(ctx.session.currentQuestionIndex, ctx.session.currentAnsIndex, transcription);

    // Increment the question index
    ctx.session.currentQuestionIndex++;

    // Fetch the next question from the Google Sheets
    const question = await fetchQuestion(ctx.session.currentQuestionIndex);

    // Ask the next question
    ctx.reply(question.question);
  } catch (error) {
    console.error('Error processing voice message:', error.message);
    ctx.reply('Error processing your voice message. Please try again.');
  }
});

async function countQuestion() {
  const sheetsAPI = google.sheets('v4');

  const response = await sheetsAPI.spreadsheets.values.get({
    auth,
    spreadsheetId: '1LptuwYT0NlA-7pMj0BA3WOiB_h8Taut8ig7R4s3GtvU',
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
      spreadsheetId: '1LptuwYT0NlA-7pMj0BA3WOiB_h8Taut8ig7R4s3GtvU',
      range: `Form Responses 1!A1:Z1`,
    });

    const valuesArray = response.data.values[0];

    const question = valuesArray[index];

    if (!question || question.trim() === '') {
      throw new Error('Empty question received from Google Sheets.');
    }

    console.log('Question fetched successfully:', question);

    return { question };
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
      spreadsheetId: '1LptuwYT0NlA-7pMj0BA3WOiB_h8Taut8ig7R4s3GtvU',
      range,
    });

    const isCellBlank = !checkBlankResponse.data.values || !checkBlankResponse.data.values[0] || checkBlankResponse.data.values[0][0] === '';

    if (isCellBlank) {
      // If the cell is blank, write the response
      await sheetsAPI.spreadsheets.values.update({
        auth,
        spreadsheetId: '1LptuwYT0NlA-7pMj0BA3WOiB_h8Taut8ig7R4s3GtvU',
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
        spreadsheetId: '1LptuwYT0NlA-7pMj0BA3WOiB_h8Taut8ig7R4s3GtvU',
        range: `Form Responses 1!${columnLetter}:${columnLetter}`,
      });

      const nextEmptyRow = nextEmptyRowResponse.data.values ? nextEmptyRowResponse.data.values.length + 1 : 1;

      // Update the  response in the next empty row
      await sheetsAPI.spreadsheets.values.update({
        auth,
        spreadsheetId: '1LptuwYT0NlA-7pMj0BA3WOiB_h8Taut8ig7R4s3GtvU',
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

// Function to transcribe the voice message
async function transcribeVoice(filePath) {
  try {
    const file = fs.readFileSync(filePath);
    const audioBytes = file.toString('base64');

    const audio = {
      content: audioBytes,
    };

    const config = {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'en-US',
    };

    const request = {
      audio: audio,
      config: config,
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results.map((result) => result.alternatives[0].transcript).join('\n');

    return transcription;
  } catch (error) {
    console.error('Error transcribing voice:', error.message);
    throw error;
  }
}

// Function to convert OGG to WAV
async function convertOggToWav(oggFilePath, wavFilePath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(oggFilePath)
      .audioCodec('pcm_s16le')
      .toFormat('wav')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(wavFilePath);
  });
}

bot.launch({ polling: { debug: true } }).then(() => {
  console.log('Bot is running');
});

