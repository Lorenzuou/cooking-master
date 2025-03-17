// recipe-voice-simulator.js - Run with: node recipe-voice-simulator.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config(); // Load environment variables from .env file

// Configuration
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN; 
const LLAMA_MODEL = "meta/meta-llama-3-8b-instruct";

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Simulate user input
async function getUserInput() {
  return new Promise((resolve) => {
    rl.question("Enter your recipe request: ", (input) => {
      resolve(input);
    });
  });
}

// Process the output chunks from Replicate streaming API
function processReplicateChunks(chunks) {
  try {
    // Join all chunks
    const completeOutput = chunks.join('');
    console.log('Complete output:', completeOutput);
    
    // Try to find and extract JSON from the output
    let jsonMatch = completeOutput.match(/\{[\s\S]*\}/);
    let recipeData;
    
    if (jsonMatch) {
      try {
        // Try to parse the matched JSON
        recipeData = JSON.parse(jsonMatch[0]);
      } catch (jsonError) {
        console.warn('Could not parse JSON directly, trying to fix formatting...');
        // Try to clean up the JSON string before parsing
        const cleanedJson = jsonMatch[0]
          .replace(/(\w+)(?=:)/g, '"$1"')  // Add quotes to keys
          .replace(/(?<=: )"([^"]*)"(?=[,}])/g, '"$1"') // Ensure string values have quotes
          .replace(/'/g, '"'); // Replace single quotes with double quotes
          
        try {
          recipeData = JSON.parse(cleanedJson);
        } catch (e) {
          console.error('Failed to parse cleaned JSON:', e);
          throw new Error('Invalid JSON format in LLM response');
        }
      }
    } else {
      throw new Error('No JSON found in LLM response');
    }
    
    // Ensure the recipe data has the required fields
    return {
      id: Date.now().toString(),
      title: recipeData.title || "Untitled Recipe",
      ingredients: Array.isArray(recipeData.ingredients) ? recipeData.ingredients : [],
      steps: Array.isArray(recipeData.steps) ? recipeData.steps : 
             Array.isArray(recipeData.instructions) ? recipeData.instructions : [],
      date: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error processing recipe chunks:', error);
    
    // Try a more forgiving approach to extract parts of the text
    const text = chunks.join('');
    const lines = text.split('\n').filter(line => line.trim() !== '');
    
    // Simple heuristic extraction
    let title = "Untitled Recipe";
    let ingredients = [];
    let steps = [];
    let currentSection = null;
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      if (lowerLine.includes('title') || lowerLine.match(/^#\s/)) {
        title = line.replace(/^#\s*/, '').replace(/title:\s*/i, '').trim();
      } else if (lowerLine.includes('ingredient') || lowerLine.match(/^##\s*ingredient/i)) {
        currentSection = 'ingredients';
      } else if (lowerLine.includes('instruction') || lowerLine.includes('step') || lowerLine.match(/^##\s*(instruction|step)/i)) {
        currentSection = 'steps';
      } else if (line.trim() && currentSection === 'ingredients' && !line.match(/^#/)) {
        ingredients.push(line.replace(/^[-*]\s*/, '').trim());
      } else if (line.trim() && currentSection === 'steps' && !line.match(/^#/)) {
        steps.push(line.replace(/^\d+\.\s*/, '').trim());
      }
    }
    
    return {
      id: Date.now().toString(),
      title: title,
      ingredients: ingredients.length > 0 ? ingredients : ["Ingredients could not be extracted"],
      steps: steps.length > 0 ? steps : ["Steps could not be extracted"],
      date: new Date().toISOString()
    };
  }
}

// Process text with Replicate using direct REST API (same as in the app)
async function processWithReplicate(text) {
  try {
    const input = {
      top_k: 0,
      top_p: 0.95,
      prompt: `You are a skilled chef who converts spoken cooking instructions into structured recipes. 
      Extract the title, ingredients with quantities, and step-by-step instructions from the following text.
      Format your response as a JSON object with fields: title, ingredients (array of strings with quantities), 
      and steps (array of strings).

      Do not write any other comments or explanations in the JSON object.
      
      Here is the transcribed cooking instruction:
      ${text}`,
      max_tokens: 1000,
      temperature: 0.1,
      system_prompt: "You are a helpful assistant",
      length_penalty: 1,
      max_new_tokens: 1000,
      stop_sequences: "<|end_of_text|>,<|eot_id|>",
      prompt_template: "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n",
      presence_penalty: 0,
    };

    console.log("🔄 Generating recipe using Replicate API...");
    
    // Create a prediction using the Replicate API
    const createResponse = await axios.post(
      'https://api.replicate.com/v1/predictions',
      {
        version: LLAMA_MODEL,
        input,
        stream: true  // Enable streaming
      },
      {
        headers: {
          'Authorization': `Token ${REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const predictionId = createResponse.data.id;
    console.log(`🔄 Recipe generation started: ${predictionId}`);
    
    // Poll for outputs and collect chunks
    const outputChunks = [];
    let complete = false;
    let attempts = 0;
    const maxAttempts = 30;
    
    while (!complete && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      
      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            'Authorization': `Token ${REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const prediction = response.data;
      
      if (prediction.status === 'succeeded') {
        if (Array.isArray(prediction.output)) {
          outputChunks.push(...prediction.output);
        }
        complete = true;
      } else if (prediction.status === 'failed') {
        throw new Error(`Prediction failed: ${prediction.error || 'Unknown error'}`);
      } else if (prediction.output && Array.isArray(prediction.output)) {
        // Collect partial outputs while still processing
        outputChunks.push(...prediction.output);
      }
      
      console.log(`🔄 Waiting for recipe... (Attempt ${attempts}/${maxAttempts})`);
    }
    
    if (!complete) {
      throw new Error("Prediction timed out");
    }

    console.log('✅ Recipe generation complete!');
    
    // Process the collected chunks
    return processReplicateChunks(outputChunks);
  } catch (error) {
    console.error('❌ Error with Replicate API:', error);
    
    // Fallback to a basic recipe with the original text
    return {
      id: Date.now().toString(),
      title: "Recipe " + new Date().toLocaleTimeString(),
      ingredients: ["Ingredients could not be automatically extracted"],
      steps: text.split('. ').filter(step => step.trim() !== ''),
      date: new Date().toISOString()
    };
  }
}

// Display recipe in a nice format
function displayRecipe(recipe) {
  console.log("\n=================================================");
  console.log(`🍲 ${recipe.title.toUpperCase()} 🍲`);
  console.log("=================================================");
  
  console.log("\n📋 INGREDIENTS:");
  recipe.ingredients.forEach((ingredient, index) => {
    console.log(`   ${index + 1}. ${ingredient}`);
  });
  
  console.log("\n📝 INSTRUCTIONS:");
  recipe.steps.forEach((step, index) => {
    console.log(`   ${index + 1}. ${step}`);
  });
  
  console.log("\n=================================================\n");
}

// Main function to run the simulation
async function runRecipeSimulation() {
  console.log("=================================================");
  console.log("🍲 RECIPE GENERATOR SIMULATOR 🍲");
  console.log("=================================================");
  
  if (!REPLICATE_API_TOKEN) {
    console.log("⚠️  No REPLICATE_API_TOKEN found. Please set it as an environment variable or in a .env file");
    process.exit(1);
  }
  
  try {
    // Get user input
    let userInput = await getUserInput();
    console.log(`📝 Processing request: "${userInput}"`);

    if (!userInput) {
        userInput = "To make a perfect roast beef, start by preheating your oven to 375 degrees Fahrenheit. You'll need a 3-pound beef roast, preferably a ribeye or sirloin cut. Season it generously with 2 tablespoons of kosher salt, 1 tablespoon of black pepper, 3 cloves of minced garlic, and 1 tablespoon of fresh rosemary. Let it come to room temperature for about 30 minutes. Heat 2 tablespoons of olive oil in a large oven-safe skillet over high heat. Sear the beef on all sides until nicely browned, about 3 minutes per side. Transfer the skillet to the oven and roast for about 45 minutes for medium-rare, or until an instant-read thermometer inserted into the center reads 135 degrees. Remove from the oven, cover loosely with foil, and let rest for 15 minutes before slicing thinly against the grain."
    } 
    // Process with Replicate (exactly as in the app)
    const recipe = await processWithReplicate(userInput);
    
    // Display the generated recipe
    displayRecipe(recipe);
    
    // Ask if the user wants to try again
    rl.question("Would you like to try another recipe? (yes/no): ", (answer) => {
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        console.log("\n");
        runRecipeSimulation();
      } else {
        console.log("Thank you for using the Recipe Generator Simulator!");
        rl.close();
      }
    });
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    rl.close();
  }
}

// Run the simulation
runRecipeSimulation();