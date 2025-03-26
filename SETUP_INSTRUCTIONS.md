# File Converter - Setup and Run Instructions

This document provides step-by-step instructions to set up and run the File Converter application.

## Prerequisites

- Python 3.x
- Node.js (v14.x or later)
- npm (v6.x or later)

## Backend Setup

1. Navigate to the backend directory:
   ```
   cd backend
   ```

2. Install the required dependencies:
   ```
   pip install flask flask-cors
   ```

3. Start the Flask server:
   ```
   python app.py
   ```

The backend server will start running on http://localhost:5000.

## Frontend Setup

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Install the required dependencies:
   ```
   npm install
   ```

3. Start the React development server:
   ```
   npm start
   ```

The frontend application will start running on http://localhost:3000.

## Usage

1. Open a web browser and navigate to http://localhost:3000
2. You will see a drop zone with the text "Drop Files Here"
3. Either drag and drop a file into this area or click the "Browse" button to select a file
4. After selecting a file, the application will upload it to the backend for format detection
5. Once processing is complete, you will see a message displaying the filename and its detected format
   (e.g., "File Uploaded: test.pdf (PDF)")

## Troubleshooting

- If you encounter CORS issues, make sure both the frontend and backend servers are running
- If the file format detection isn't working, check that the backend server is running correctly
- If the upload doesn't work, ensure that the backend endpoint URL in the frontend code is correct (http://localhost:5000/detect) 