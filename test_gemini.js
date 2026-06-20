import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.VITE_GEMINI_API_KEY;
console.log("VITE_GEMINI_API_KEY exists:", !!apiKey);
if (apiKey) {
  console.log("Key prefix:", apiKey.substring(0, 6));
}

const genAI = new GoogleGenerativeAI(apiKey || '');

async function run() {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
    
    console.log("Sending request to Gemini (gemini-2.5-flash)...");
    const result = await model.generateContent("Say hello in JSON format");
    console.log("Response text:", result.response.text());
  } catch (err) {
    console.error("Gemini Error:", err);
  }
}

run();
