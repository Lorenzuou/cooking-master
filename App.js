import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, FlatList, Modal, Button } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { REPLICATE_API_TOKEN } from '@env';
import { styles } from './styles';
const RecipeVoiceApp = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [currentRecipe, setCurrentRecipe] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(null);
  const [audioUri, setAudioUri] = useState(null);


  const startRecording = async () => {
    try {
      // Request permissions
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setError('Permission to access microphone was denied');
        return;
      }

      // Set audio mode for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Create and start recording
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      setRecording(recording);
      setIsRecording(true);
      Alert.alert('Recording', 'Recording started. Tap the button again to stop.');
    } catch (error) {
      console.error('Failed to start recording:', error);
      setError('Failed to start recording');
      setIsRecording(false);
    }
  };


  const simulateTranscription = () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const sampleText = "Descasque, corte ao meio e fatie a cebola em meias-luas (não muito finas). Leve ao fogo baixo uma panela wok (ou frigideira grande antiaderente), regue com 1 colher (sopa) de azeite e junte a cebola. Tempere com uma pitada de sal e deixe cozinhar por cerca de 15 minutos, mexendo de vez em quando, até a dourar. Enquanto isso, prepare os outros ingredientes: lave, descasque e passe a cenoura pela parte grossa do ralador; lave e seque a salsinha e a cebolinha. Pique fino a salsinha e corte a cebolinha em fatias médias. Transfira as cebolas douradas para a tigela com o arroz cozido. Aumente o fogo para médio, regue com mais um fio de azeite e acrescente a cenoura. Refogue por 2 minutos e junte salsinha e a cebolinha. Desligue o fogo, junte ao arroz e misture bem. Passe um papel-toalha para limpar a panela wok. Quebre os ovos numa tigela. Leve a panela ao fogo baixo e regue com um fio de azeite. Junte os ovos e mexa rapidamente com uma colher. Quando começar a cozinhar, junte o arroz e misture vigorosamente. Aumente o fogo, tempere com sal e pimenta-do-reino e misture bem por 1 minuto ou até aquecer bem o arroz. Sirva a seguir.";
        resolve(sampleText);
      }, 1500);
    });
  };

  const saveRecipe = () => {
    if (currentRecipe) {
      setRecipes([...recipes, currentRecipe]);
      setModalVisible(false);
      setCurrentRecipe(null);
      setTranscribedText('');
    }
  };


const stopRecording = async () => {
  try {
    if (!recording) return;
    
    setIsRecording(false);
    setIsProcessing(true);
    
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setAudioUri(uri);
    setRecording(null);
    
    // Process the audio file
    await transcribeAudio(uri);
  } catch (err) {
    console.error('Failed to stop recording', err);
    setError('Failed to stop recording');
  } finally {
    setIsProcessing(false);
  }
};

// Convert audio to base64 and send to Replicate
const transcribeAudio = async (uri) => {
  try {
    console.log('Processing audio...');
    // Convert audio to base64
    const base64Audio = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    console.log('Audio processed');
    // Transcribe audio using Replicate API
    const transcriptionResult = await sendTranscriptionRequest(base64Audio);
    setTranscribedText(transcriptionResult);
    console.log('Transcription result:', transcriptionResult);
    // Generate receipt based on transcription
    if (transcriptionResult) {
      const recipeResult = await generateRecipe(transcriptionResult);
      console.log('Recipe result:', recipeResult);

      // Parse the recipe result
      const parsedRecipe = parseRecipeResult(recipeResult);
      console.log('Parsed recipe:', parsedRecipe);
      setCurrentRecipe(parsedRecipe);
      
      setModalVisible(true);
    }
  } catch (err) {
    console.error('Failed to process audio', err);
    setError('Failed to process audio');
  }
};

// Send transcription request to Replicate API
const sendTranscriptionRequest = async (base64Audio) => {
  console.log('Sending transcription request...');
  try {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Use Whisper model for transcription
        version: "84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb", // whisper model
        input: {
          audio_file: `data:audio/m4a;base64,${base64Audio}`,
        },
      }),
    });
    console.log('Transcription request sent');
    const prediction = await response.json();
    console.log('Transcription prediction:', prediction);
    return await pollForResults(prediction.id);
  } catch (err) {
    console.error('Transcription request failed', err);
    setError('Transcription request failed');
    return '';
  }
};

// Generate recipe from transcription
const generateRecipe = async (transcriptionText) => {
  try {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Use a text generation model
        version: "meta/meta-llama-3-8b-instruct",
        input: {
          prompt: `You are a skilled chef who converts spoken cooking instructions into structured recipes. 
            Extract the title, ingredients with quantities, and step-by-step instructions from this text.
            Format your response as a JSON object with fields: title, ingredients (array of strings with quantities), 
            and steps (array of strings). You write all the the instructions in brasilian portuguese. Do not make any other comment only give me the structured answer.
            Text: ${transcriptionText}`,
            max_tokens: 1000,
            temperature: 0.1,
            top_p: 0.95,
        },
      }),
    });
    
    const prediction = await response.json();
    
    // Poll for results
    return await pollForResults(prediction.id);
  } catch (err) {
    console.error('Recipe generation failed', err);
    setError('Recipe generation failed');
    return '';
  }
};
// Poll for Replicate results
const pollForResults = async (predictionId) => {
  let status = 'starting';
  console.log('Polling for results...');
  while (status !== 'succeeded' && status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
      },
    });
    
    if (response.status === 404) {
      throw new Error('Prediction not found');
    }
    
    console.log('Polling response:', response);
    
    const prediction = await response.json();
    status = prediction.status;
    
    if (status === 'succeeded') {
      return typeof prediction.output === 'string' 
        ? prediction.output 
        : prediction.output.transcription || JSON.stringify(prediction.output);
    }
  }
  
  return '';
};

function convertStringToJson(inputString) {
  try {
      // First parse the string into an array
      const arrayOfStrings = JSON.parse(inputString);
      
      // Join all array elements
      const jsonString = arrayOfStrings.join('');
      
      // Parse the joined string into a JSON object
      const jsonObject = JSON.parse(jsonString);
      return jsonObject;
  } catch (error) {
      console.error('Error parsing JSON:', error);
      return null;
  }
}
const parseRecipeResult = (recipeData) => {
  try {
  
    // Parse the JSON string into an object
    const recipeObject = convertStringToJson(recipeData);
    
    // Validate the structure
    if (!recipeObject.ingredients || !recipeObject.steps) {
      console.log('Missing ingredients or steps in recipe:', recipeObject);
      // Provide default empty arrays to prevent mapping errors
      return {
        title: recipeObject.title || 'Untitled Recipe',
        ingredients: recipeObject.ingredients || [],
        steps: recipeObject.steps || []
      };
    }
    
    return recipeObject;
  } catch (error) {
    console.error('Error parsing recipe:', error);
    // Return a default recipe structure if parsing fails
    return {
      title: 'Parsing Error',
      ingredients: [],
      steps: []
    };
  }
};

const handleRecipeResponse = (recipeResultArray) => {
  try {
    // Join array fragments and parse JSON
    const jsonString = recipeResultArray.join('');
    const recipeObject = JSON.parse(jsonString);
    
    // Create standardized recipe object
    const newRecipe = {
      id: Date.now().toString(), // Generate unique ID
      title: recipeObject.title || 'Untitled Recipe',
      ingredients: recipeObject.ingredients || [],
      steps: recipeObject.steps || []
    };

    // Update recipes state
    setRecipes(prevRecipes => [...prevRecipes, newRecipe]);
    setCurrentRecipe(newRecipe);
    setModalVisible(true);
    
  } catch (error) {
    console.error('Error processing recipe:', error);
    Alert.alert('Error', 'Failed to process recipe data');
  }
};

const renderRecipeItem = ({ item }) => (
  <TouchableOpacity 
    style={styles.recipeItem}
    onPress={() => {
      // Use the item directly instead of recipeResultArray
      setCurrentRecipe(item);
      setModalVisible(true); // Assuming you want to show the modal
    }}
  >
    <Text style={styles.recipeTitle}>{item.title}</Text>
  </TouchableOpacity>
);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice to Recipe</Text>
      
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.dismissError}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {isProcessing ? (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.processingText}>Processing your recipe...</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordingButton]}
          onPress={isRecording ? stopRecording : startRecording}
        >
        <Button
          title={isRecording ? "Stop Recording" : "Start Recording"}
          onPress={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
        />
        </TouchableOpacity>
      )}
      
      {recipes.length > 0 ? (
        <FlatList
          data={recipes}
          renderItem={renderRecipeItem}
          keyExtractor={item => item.id}
          style={styles.recipeList}
        />
      ) : (
        <Text style={styles.emptyText}>
          No recipes yet. Start recording to create your first recipe!
        </Text>
      )}
      
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalView}>
          {currentRecipe && (
            <>
              <Text style={styles.modalTitle}>{currentRecipe.title}</Text>
              <Text style={styles.sectionTitle}>Ingredients:</Text>
              {currentRecipe.ingredients.map((ingredient, index) => (
                <Text key={index} style={styles.ingredient}>• {ingredient}</Text>
              ))}
              <Text style={styles.sectionTitle}>Instructions:</Text>
              {currentRecipe.steps.map((step, index) => (
                <Text key={index} style={styles.step}>{index + 1}. {step}</Text>
              ))}
              
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.saveButton]}
                  onPress={saveRecipe}
                >
                  <Text style={styles.buttonText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
};


export default RecipeVoiceApp;