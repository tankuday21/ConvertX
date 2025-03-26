# File Converter - Format Detection (Step 1)

This is a simple web application that allows users to upload files via drag-and-drop or a browse button. The application automatically detects the file format and displays it to the user.

## System Architecture

- **Frontend**: React.js with simple CSS styling
- **Backend**: Python Flask API

## How It Works

1. The user uploads a file via drag-and-drop or the browse button
2. The file is sent to the backend API for format detection
3. The backend uses Python's mimetypes library to determine the file format
4. The detected format is sent back to the frontend
5. The frontend displays the file name and detected format to the user

## Setup and Run Instructions

### Backend Setup
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
   The server will run on http://localhost:5000

### Frontend Setup
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
   The application will run on http://localhost:3000

## Features

- Drag-and-drop file upload
- File browsing capability
- Automatic file format detection
- Clean and minimal UI
- Informative feedback messages 