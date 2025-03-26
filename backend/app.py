from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import mimetypes
import os
import logging
from pdf2docx import Converter
from PIL import Image
import uuid
import tempfile
import shutil
import sys

# Configure logging to output to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configure CORS with specific settings
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
    }
})

try:
    # Create temporary directories in /tmp for Railway compatibility
    TEMP_DIR = os.path.join(tempfile.gettempdir(), 'convertx_temp')
    CONVERTED_DIR = os.path.join(TEMP_DIR, 'converted')
    
    # Clean up existing directories if they exist
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    
    # Create fresh directories
    os.makedirs(TEMP_DIR, exist_ok=True)
    os.makedirs(CONVERTED_DIR, exist_ok=True)
    
    logger.info(f"Created temporary directories: {TEMP_DIR}, {CONVERTED_DIR}")
except Exception as e:
    logger.error(f"Failed to create temporary directories: {str(e)}")
    # Don't fail startup, we'll create directories on-demand

def ensure_directories():
    """Ensure temporary directories exist"""
    try:
        os.makedirs(TEMP_DIR, exist_ok=True)
        os.makedirs(CONVERTED_DIR, exist_ok=True)
    except Exception as e:
        logger.error(f"Error ensuring directories: {str(e)}")

def cleanup_files():
    """Clean up temporary files"""
    try:
        if os.path.exists(TEMP_DIR):
            shutil.rmtree(TEMP_DIR)
            os.makedirs(CONVERTED_DIR, exist_ok=True)
    except Exception as e:
        logger.error(f"Error cleaning up files: {str(e)}")

def convert_pdf_to_docx(input_path, output_path):
    """Convert PDF to DOCX"""
    try:
        cv = Converter(input_path)
        cv.convert(output_path)
        cv.close()
        return True
    except Exception as e:
        logger.error(f"Error converting PDF to DOCX: {str(e)}")
        return False

def convert_jpg_to_png(input_path, output_path):
    """Convert JPG to PNG"""
    try:
        with Image.open(input_path) as img:
            img.save(output_path, 'PNG')
        return True
    except Exception as e:
        logger.error(f"Error converting JPG to PNG: {str(e)}")
        return False

@app.route('/')
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "healthy"}), 200

@app.route('/detect', methods=['POST'])
def detect_file_format():
    """
    Endpoint to detect the format of an uploaded file.
    Accepts a file via POST request and returns the detected format.
    """
    ensure_directories()  # Ensure directories exist
    try:
        # Check if a file was included in the request
        if 'file' not in request.files:
            logger.error("No file provided in request")
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        # Check if a file was selected
        if file.filename == '':
            logger.error("No file selected")
            return jsonify({'error': 'No file selected'}), 400
        
        # Save the file temporarily
        filename = file.filename
        temp_path = os.path.join(TEMP_DIR, filename)
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
            
            logger.info(f"Successfully detected format: {format_type} for file: {filename}")
            return jsonify({'format': format_type})
        
        finally:
            # Clean up: remove the temporary file
            if os.path.exists(temp_path):
                os.remove(temp_path)
                logger.info(f"Cleaned up temporary file: {temp_path}")
    
    except Exception as e:
        logger.error(f"Error processing file: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/convert', methods=['POST'])
def convert_file():
    """
    Endpoint to convert uploaded file to specified format.
    Accepts a file and target format via POST request.
    """
    ensure_directories()  # Ensure directories exist
    try:
        if 'file' not in request.files or 'outputFormat' not in request.form:
            return jsonify({'error': 'Missing file or output format'}), 400
        
        file = request.files['file']
        output_format = request.form['outputFormat'].upper()
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Save uploaded file temporarily
        input_filename = file.filename
        input_path = os.path.join(TEMP_DIR, input_filename)
        file.save(input_path)
        
        try:
            # Generate unique output filename
            output_filename = f"converted_{uuid.uuid4().hex[:8]}.{output_format.lower()}"
            output_path = os.path.join(CONVERTED_DIR, output_filename)
            
            # Get input format
            _, input_ext = os.path.splitext(input_filename)
            input_format = input_ext[1:].upper()
            
            # Perform conversion based on formats
            success = False
            if input_format == 'PDF' and output_format == 'DOCX':
                success = convert_pdf_to_docx(input_path, output_path)
            elif input_format == 'JPG' and output_format == 'PNG':
                success = convert_jpg_to_png(input_path, output_path)
            else:
                return jsonify({'error': f'Conversion from {input_format} to {output_format} not supported'}), 400
            
            if success:
                # Return the download URL
                download_url = f"/download/{output_filename}"
                return jsonify({
                    'success': True,
                    'downloadUrl': download_url,
                    'message': f'File converted successfully to {output_format}'
                })
            else:
                return jsonify({'error': 'Conversion failed'}), 500
                
        finally:
            # Clean up input file
            if os.path.exists(input_path):
                os.remove(input_path)
    
    except Exception as e:
        logger.error(f"Error converting file: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>')
def download_file(filename):
    """Serve converted files"""
    try:
        file_path = os.path.join(CONVERTED_DIR, filename)
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
            
        return send_file(
            file_path,
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        logger.error(f"Error serving file: {str(e)}")
        return jsonify({'error': 'File not found'}), 404

@app.teardown_appcontext
def cleanup(error):
    """Clean up temporary files when the application context ends"""
    cleanup_files()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"Starting server on port {port}")
    app.run(host='0.0.0.0', port=port) 