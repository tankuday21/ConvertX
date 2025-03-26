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
from threading import Timer
import time
import json

# Configure logging to output to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configure CORS with specific settings
CORS(app, 
     resources={r"/*": {
         "origins": ["https://convert-x.vercel.app", "http://localhost:3000"],
         "methods": ["GET", "POST", "OPTIONS"],
         "allow_headers": ["Content-Type", "Authorization", "Accept"],
         "expose_headers": ["Content-Type", "Authorization"],
         "supports_credentials": False,
         "max_age": 3600
     }})

# Create persistent directories for file storage
UPLOAD_DIR = os.path.join(tempfile.gettempdir(), 'convertx_uploads')
CONVERTED_DIR = os.path.join(tempfile.gettempdir(), 'convertx_converted')

# Ensure directories exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CONVERTED_DIR, exist_ok=True)

# Dictionary to store file expiry times
file_expiry = {}

def cleanup_old_files():
    """Clean up files older than 5 minutes"""
    current_time = time.time()
    files_to_delete = []
    
    # Find expired files
    for filepath, expiry_time in file_expiry.items():
        if current_time > expiry_time:
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
                    logger.info(f"Cleaned up expired file: {filepath}")
            except Exception as e:
                logger.error(f"Error cleaning up file {filepath}: {str(e)}")
            files_to_delete.append(filepath)
    
    # Remove expired entries from dictionary
    for filepath in files_to_delete:
        file_expiry.pop(filepath, None)

def schedule_cleanup(filepath, minutes=5):
    """Schedule a file for cleanup after specified minutes"""
    file_expiry[filepath] = time.time() + (minutes * 60)

def convert_pdf_to_docx(input_path, output_path):
    """Convert PDF to DOCX with progress logging"""
    try:
        logger.info(f"Starting PDF to DOCX conversion: {input_path}")
        start_time = time.time()
        
        cv = Converter(input_path)
        cv.convert(output_path)
        cv.close()
        
        end_time = time.time()
        logger.info(f"Conversion completed in {end_time - start_time:.2f} seconds")
        return True
    except Exception as e:
        logger.error(f"Error converting PDF to DOCX: {str(e)}")
        return False

def convert_image(input_path, output_path, output_format):
    """Convert image to specified format with progress logging"""
    try:
        logger.info(f"Starting image conversion to {output_format}: {input_path}")
        start_time = time.time()
        
        with Image.open(input_path) as img:
            # Convert to RGB if saving as JPEG
            if output_format.upper() in ['JPG', 'JPEG']:
                if img.mode in ('RGBA', 'LA'):
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    background.paste(img, mask=img.split()[-1])
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')
            
            # Save with optimization
            if output_format.upper() in ['JPG', 'JPEG']:
                img.save(output_path, 'JPEG', quality=95, optimize=True)
            elif output_format.upper() == 'PNG':
                img.save(output_path, 'PNG', optimize=True)
            else:
                img.save(output_path, output_format.upper())
        
        end_time = time.time()
        logger.info(f"Conversion completed in {end_time - start_time:.2f} seconds")
        return True
    except Exception as e:
        logger.error(f"Error converting image: {str(e)}")
        return False

@app.route('/', methods=['GET', 'OPTIONS'])
def health_check():
    """Health check endpoint"""
    if request.method == 'OPTIONS':
        return '', 204
    return jsonify({"status": "healthy"}), 200

@app.route('/detect', methods=['POST'])
def detect_file_format():
    """Endpoint to detect file format"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Save the file
        filename = str(uuid.uuid4()) + '_' + file.filename
        filepath = os.path.join(UPLOAD_DIR, filename)
        file.save(filepath)
        
        # Schedule cleanup
        schedule_cleanup(filepath)
        
        # Detect format
        mime_type, _ = mimetypes.guess_type(file.filename)
        if mime_type:
            format_type = mime_type.split('/')[-1].upper()
        else:
            _, extension = os.path.splitext(file.filename)
            format_type = extension[1:].upper() if extension else 'UNKNOWN'
        
        logger.info(f"Detected format {format_type} for file {file.filename}")
        return jsonify({'format': format_type})
    
    except Exception as e:
        logger.error(f"Error in detect_file_format: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/convert-batch', methods=['POST'])
def convert_batch():
    """Endpoint to convert multiple files"""
    try:
        files = request.files.getlist('files')
        if not files:
            return jsonify({'error': 'No files provided'}), 400
        
        results = []
        for i, file in enumerate(files):
            try:
                # Get output format for this file
                output_format = request.form.get(f'format_{i}')
                if not output_format:
                    raise ValueError(f'No output format specified for file {file.filename}')
                
                # Save input file
                input_filename = str(uuid.uuid4()) + '_' + file.filename
                input_path = os.path.join(UPLOAD_DIR, input_filename)
                file.save(input_path)
                
                # Generate output filename
                output_filename = f"converted_{uuid.uuid4().hex[:8]}.{output_format.lower()}"
                output_path = os.path.join(CONVERTED_DIR, output_filename)
                
                # Get input format
                _, input_ext = os.path.splitext(file.filename)
                input_format = input_ext[1:].upper()
                
                # Perform conversion
                success = False
                if input_format == 'PDF' and output_format == 'DOCX':
                    success = convert_pdf_to_docx(input_path, output_path)
                elif input_format in ['JPG', 'JPEG', 'PNG', 'BMP'] and output_format in ['PNG', 'JPG', 'JPEG']:
                    success = convert_image(input_path, output_path, output_format)
                else:
                    raise ValueError(f'Conversion from {input_format} to {output_format} not supported')
                
                # Schedule cleanup
                schedule_cleanup(input_path)
                schedule_cleanup(output_path, minutes=10)
                
                if success:
                    results.append({
                        'filename': file.filename,
                        'status': 'success',
                        'downloadUrl': f"/download/{output_filename}",
                        'error': None
                    })
                else:
                    results.append({
                        'filename': file.filename,
                        'status': 'error',
                        'downloadUrl': None,
                        'error': 'Conversion failed'
                    })
                
            except Exception as e:
                logger.error(f"Error converting file {file.filename}: {str(e)}")
                results.append({
                    'filename': file.filename,
                    'status': 'error',
                    'downloadUrl': None,
                    'error': str(e)
                })
        
        return jsonify({
            'success': True,
            'results': results,
            'message': f'Processed {len(files)} files'
        })
    
    except Exception as e:
        logger.error(f"Error in convert_batch: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>')
def download_file(filename):
    """Endpoint to download converted files"""
    try:
        file_path = os.path.join(CONVERTED_DIR, filename)
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(
            file_path,
            as_attachment=True,
            download_name=filename,
            mimetype='application/octet-stream'
        )
    except Exception as e:
        logger.error(f"Error serving file {filename}: {str(e)}")
        return jsonify({'error': 'File not found'}), 404

# Start periodic cleanup
def periodic_cleanup():
    """Run cleanup every minute"""
    cleanup_old_files()
    Timer(60.0, periodic_cleanup).start()

# Start the cleanup timer
periodic_cleanup()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    logger.info(f"Starting server on port {port}")
    app.run(host='0.0.0.0', port=port) 