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
from werkzeug.utils import secure_filename
from PyPDF2 import PdfReader, PdfWriter

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

def compress_pdf(input_path, output_path, compression_level='medium'):
    """Compress PDF based on compression level"""
    try:
        reader = PdfReader(input_path)
        writer = PdfWriter()
        
        # Set compression parameters based on level
        if compression_level == 'low':
            image_quality = 60
            compress_images = True
        elif compression_level == 'medium':
            image_quality = 40
            compress_images = True
        else:  # high
            image_quality = 20
            compress_images = True
        
        # Copy pages with compression
        for page in reader.pages:
            writer.add_page(page)
        
        # Apply compression settings
        writer.add_metadata(reader.metadata)
        
        with open(output_path, 'wb') as output_file:
            writer.write(output_file)
        
        return True
    except Exception as e:
        logger.error(f"Error compressing PDF: {str(e)}")
        return False

def convert_image(input_path, output_path, output_format, quality=80):
    """Convert image to specified format with compression"""
    try:
        logger.info(f"Starting image conversion to {output_format} with quality {quality}: {input_path}")
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
            
            # Save with compression
            if output_format.upper() in ['JPG', 'JPEG']:
                img.save(output_path, 'JPEG', quality=quality, optimize=True)
            elif output_format.upper() == 'PNG':
                img.save(output_path, 'PNG', 
                        optimize=True,
                        quality=quality if quality < 95 else 95)  # PNG uses quality differently
            else:
                img.save(output_path, output_format.upper())
        
        end_time = time.time()
        logger.info(f"Conversion completed in {end_time - start_time:.2f} seconds")
        return True
    except Exception as e:
        logger.error(f"Error converting image: {str(e)}")
        return False

def convert_pdf_to_docx(input_path, output_path, compression_level='medium'):
    """Convert PDF to DOCX with compression"""
    try:
        logger.info(f"Starting PDF to DOCX conversion with {compression_level} compression: {input_path}")
        start_time = time.time()
        
        # First compress the PDF if needed
        if compression_level != 'low':
            temp_pdf = os.path.join(tempfile.gettempdir(), f'compressed_{uuid.uuid4().hex}.pdf')
            if not compress_pdf(input_path, temp_pdf, compression_level):
                logger.warning("PDF compression failed, using original file")
                temp_pdf = input_path
        else:
            temp_pdf = input_path
        
        # Convert to DOCX
        cv = Converter(temp_pdf)
        cv.convert(output_path)
        cv.close()
        
        # Clean up temporary file
        if temp_pdf != input_path and os.path.exists(temp_pdf):
            os.remove(temp_pdf)
        
        end_time = time.time()
        logger.info(f"Conversion completed in {end_time - start_time:.2f} seconds")
        return True
    except Exception as e:
        logger.error(f"Error converting PDF to DOCX: {str(e)}")
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

@app.route('/convert', methods=['POST'])
def convert_files():
    """Endpoint to convert files with compression settings"""
    try:
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400

        files = request.files.getlist('files')
        results = []
        
        for i, file in enumerate(files):
            try:
                # Get output format and compression settings
                output_format = request.form.get(f'outputFormats[{i}]')
                compression_str = request.form.get(f'compression[{i}]')
                compression_settings = json.loads(compression_str) if compression_str else {}
                
                if not output_format:
                    raise ValueError(f'No output format specified for file {file.filename}')
                
                # Save input file
                input_filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
                input_path = os.path.join(UPLOAD_DIR, input_filename)
                file.save(input_path)
                schedule_cleanup(input_path)
                
                # Generate output filename
                name_without_ext = os.path.splitext(secure_filename(file.filename))[0]
                output_filename = f"{name_without_ext}_{uuid.uuid4().hex[:8]}.{output_format.lower()}"
                output_path = os.path.join(CONVERTED_DIR, output_filename)
                
                success = False
                # Handle image conversion
                if output_format.upper() in ['PNG', 'JPG', 'JPEG']:
                    quality = compression_settings.get('quality', 80)
                    success = convert_image(input_path, output_path, output_format, quality)
                
                # Handle PDF to DOCX conversion
                elif output_format.upper() == 'DOCX':
                    compression_level = compression_settings.get('level', 'medium')
                    success = convert_pdf_to_docx(input_path, output_path, compression_level)
                
                if success:
                    # Schedule cleanup for output file
                    schedule_cleanup(output_path)
                    # Generate download URL
                    download_url = f"/download/{os.path.basename(output_path)}"
                    results.append({
                        'filename': file.filename,
                        'status': 'success',
                        'downloadLink': download_url
                    })
                else:
                    results.append({
                        'filename': file.filename,
                        'status': 'error',
                        'error': 'Conversion failed'
                    })
                
            except Exception as e:
                logger.error(f"Error processing file {file.filename}: {str(e)}")
                results.append({
                    'filename': file.filename,
                    'status': 'error',
                    'error': str(e)
                })
                
        return jsonify(results)
        
    except Exception as e:
        logger.error(f"Error in convert_files: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>')
def download_file(filename):
    """Endpoint to download converted files"""
    try:
        file_path = os.path.join(CONVERTED_DIR, filename)
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404

        # Get the correct MIME type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = 'application/octet-stream'

        # Send file with proper MIME type and as_attachment=True
        return send_file(
            file_path,
            mimetype=mime_type,
            as_attachment=True,
            download_name=filename
        )

    except Exception as e:
        logger.error(f"Error downloading file {filename}: {str(e)}")
        return jsonify({'error': str(e)}), 500

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