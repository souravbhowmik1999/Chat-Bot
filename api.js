const axios = require('axios');
const fs = require('fs');
require('dotenv').config(); // Load environment variables from .env file

const apiUrlEnglish = 'https://demo-api.models.ai4bharat.org/inference/asr/whisper';
//for other local languages
const apiUrlForAllWithoutEnglish = 'https://demo-api.models.ai4bharat.org/inference/asr/conformer';

const sttUrl = 'https://demo-api.models.ai4bharat.org/inference/tts';

// Function to send an audio file to the AI4Bharat API and transcribe it
async function transcribeAudio(audioFilePath, language) {
  try {
    let apiUrl;
    const requestBody = {
      config: {
        language: {
          sourceLanguage: language, // Adjust the source language as needed
        },
        transcriptionFormat: {
          value: 'transcript',
        },
        audioFormat: "wav",
        samplingRate: "48000",
        postProcessors: null
      },
      audio: [{
        audioContent: audioFilePath
      }],
      controlConfig: {
        dataTracking: true
      }
    };
    if(language == 'en'){
      apiUrl = apiUrlEnglish;
    }else{
      apiUrl = apiUrlForAllWithoutEnglish;
    }
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json', // Adjust content type as needed
      },
    });

    return response;
  } catch (error) {
    console.error('Error from AI4Bharat api:', error);
    throw error;
  }
}


async function textToAudio(text,language) {
  try {

    const requestBody = {
      controlConfig: {
        dataTracking: true
      },
      input: [
        {
          source: text
        }
      ],
      config: {
        gender: "female",
        language: {
          sourceLanguage: language
        }
      }
    };

    const response = await axios.post(sttUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return response;
  } catch (error) {
    console.error('Error from AI4Bharat api:', error);
    throw error;
  }
}

module.exports = { transcribeAudio, textToAudio };