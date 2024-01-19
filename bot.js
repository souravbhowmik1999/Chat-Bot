const { Telegraf, session } = require('telegraf');
const { google } = require('googleapis');
require('dotenv').config(); // Load environment variables from .env file

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
      ctx.reply('Form fillup successfully');
      ctx.reply('You have completed the form. Type /start to submit again.');
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
    // console.log('Fetching question from Google Sheets...');

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
      // If the cell is blank, write the response
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

      // Update the response in the next empty row
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

