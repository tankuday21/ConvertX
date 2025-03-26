from flask import Flask, request, jsonify
from flask_cors import CORS
import mimetypes
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

@app.route('/detect', methods=['POST'])
def detect_file_format():
    """
    Endpoint to detect the format of an uploaded file.
    Accepts a file via POST request and returns the detected format.
    """
    # Check if a file was included in the request
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    # Check if a file was selected
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Save the file temporarily
    filename = file.filename
    temp_path = os.path.join(os.getcwd(), filename)
    file.save(temp_path)
    
    try:
        # Detect the file format using mimetypes
        mime_type, _ = mimetypes.guess_type(filename)
        
        # Extract format from MIME type or fallback to file extension
        if mime_type:
            format_type = mime_type.split('/')[-1].upper()
        else:
            # Fallback to file extension
            _, extension = os.path.splitext(filename)
            format_type = extension[1:].upper() if extension else 'UNKNOWN'
        
        return jsonify({'format': format_type})
    
    finally:
        # Clean up: remove the temporary file
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port) 