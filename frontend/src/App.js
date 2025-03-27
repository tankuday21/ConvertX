import React, { useState, useCallback, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import useDrivePicker from 'react-google-drive-picker';
import { Document, Page } from 'react-pdf';
import * as pdfjsLib from 'pdfjs-dist';
import './App.css';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Google Drive API configuration
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const GOOGLE_API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
const GOOGLE_APP_ID = process.env.REACT_APP_GOOGLE_APP_ID;

function App() {
  const [files, setFiles] = useState([]);
  const [fileInfos, setFileInfos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [conversionResults, setConversionResults] = useState([]);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [previews, setPreviews] = useState({});
  const [accessToken, setAccessToken] = useState(null);
  const [conversionComplete, setConversionComplete] = useState(false);
  const [compressionSettings, setCompressionSettings] = useState({});
  const [pdfPreviews, setPdfPreviews] = useState({});
  
  // Google Drive Picker setup
  const [openPicker] = useDrivePicker();
  
  // Google OAuth login
  const login = useGoogleLogin({
    onSuccess: (response) => {
      setAccessToken(response.access_token);
      setError(null);
    },
    onError: (error) => {
      console.error('Google OAuth error:', error);
      setError('Failed to authenticate with Google');
    },
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
  });
  
  // Get conversion options based on file format
  const getConversionOptions = (format) => {
    switch (format.toUpperCase()) {
      case 'PDF':
        return ['DOCX'];
      case 'JPG':
      case 'JPEG':
      case 'PNG':
      case 'BMP':
        return ['PNG', 'JPG', 'JPEG'];
      default:
        return [];
    }
  };
  
  // Function to check backend connection with retries
  const checkBackendConnection = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const backendUrl = process.env.REACT_APP_BACKEND_URL;
        if (!backendUrl) {
          throw new Error('Backend URL not configured');
        }
        
        console.log(`Attempting to connect to backend: ${backendUrl}`);
        
        const response = await fetch(`${backendUrl}/`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          mode: 'cors',
          cache: 'no-cache',
        });
        
        if (response.ok) {
          console.log('Backend connection successful');
          setIsBackendConnected(true);
          setError(null);
          return true;
        }
        
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Backend health check failed');
      } catch (err) {
        console.error(`Backend connection attempt ${i + 1} failed:`, err);
        if (i === retries - 1) {
          setError(`Backend connection error: ${err.message}. Please refresh the page to try again.`);
          setIsBackendConnected(false);
        }
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    return false;
  };
  
  // Check backend connection on component mount
  useEffect(() => {
    checkBackendConnection();
  }, []);
  
  // Function to make API calls with retries
  const makeApiCall = async (url, options, retries = 2) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          mode: 'cors',
          cache: 'no-cache',
          headers: {
            'Accept': 'application/json',
            ...options.headers,
          },
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'API call failed');
        }
        
        return await response.json();
      } catch (err) {
        console.error(`API call attempt ${i + 1} failed:`, err);
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  };
  
  // Handle file drop event
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setFiles(prevFiles => [...prevFiles, ...droppedFiles]);
      droppedFiles.forEach(file => detectFileFormat(file));
    }
  }, []);
  
  // Handle file selection via browse button
  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(prevFiles => [...prevFiles, ...selectedFiles]);
      selectedFiles.forEach(file => detectFileFormat(file));
    }
  };
  
  // Handle Google Drive file selection
  const handleOpenPicker = async () => {
    if (!accessToken) {
      await login();
      return;
    }

    openPicker({
      clientId: GOOGLE_CLIENT_ID,
      developerKey: GOOGLE_API_KEY,
      viewId: 'DOCS',
      showUploadView: true,
      showUploadFolders: true,
      supportDrives: true,
      multiselect: true,
      callbackFunction: async (data) => {
        if (data.action === 'picked') {
          const pickedFiles = data.docs;
          for (const file of pickedFiles) {
            try {
              const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                headers: {
                  'Authorization': `Bearer ${accessToken}`
                }
              });

              if (!response.ok) {
                throw new Error(`Failed to download file: ${response.statusText}`);
              }

              const blob = await response.blob();
              const fileObject = new File([blob], file.name, { type: file.mimeType });
              setFiles(prevFiles => [...prevFiles, fileObject]);
              detectFileFormat(fileObject);
            } catch (err) {
              console.error('Error downloading file from Google Drive:', err);
              setError(`Error downloading file from Google Drive: ${err.message}`);
            }
          }
        }
      },
    });
  };
  
  // Save file to Google Drive
  const handleSaveToGoogleDrive = async (downloadUrl, filename) => {
    try {
      if (!accessToken) {
        await login();
        return;
      }

      // First, download the file
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      const blob = await response.blob();

      // Create the metadata
      const metadata = {
        name: filename,
        mimeType: blob.type,
      };

      // Create multipart request
      const boundary = '-------314159265358979323846';
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";

      const metadataContent = JSON.stringify(metadata);
      
      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        metadataContent +
        delimiter +
        'Content-Type: ' + blob.type + '\r\n\r\n' +
        await blob.text() +
        close_delim;

      // Upload to Google Drive
      const uploadResponse = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartRequestBody,
        }
      );

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error?.message || 'Failed to upload to Google Drive');
      }

      const result = await uploadResponse.json();
      console.log('File uploaded to Google Drive:', result);
      setError(null);

    } catch (err) {
      console.error('Error saving to Google Drive:', err);
      setError(`Error saving to Google Drive: ${err.message}`);
      if (err.message.includes('authentication')) {
        await login();
      }
    }
  };
  
  // Function to generate preview for a file
  const generatePreview = async (file) => {
    try {
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        setPreviews(prev => ({ ...prev, [file.name]: previewUrl }));
      } else if (file.type === 'application/pdf') {
        const fileUrl = URL.createObjectURL(file);
        const pdf = await pdfjsLib.getDocument(fileUrl).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
        const previewUrl = canvas.toDataURL();
        setPdfPreviews(prev => ({ ...prev, [file.name]: previewUrl }));
        URL.revokeObjectURL(fileUrl);
      }
    } catch (err) {
      console.error('Error generating preview:', err);
      setError(`Error generating preview for ${file.name}`);
    }
  };
  
  // Update file detection to include preview generation
  const detectFileFormat = async (file) => {
    try {
      const format = file.name.split('.').pop().toUpperCase();
      const conversionOptions = getConversionOptions(format);
      
      setFileInfos(prev => [
        ...prev,
        {
          name: file.name,
          format: format,
          size: file.size,
          outputFormat: conversionOptions[0] || '',
          status: 'pending'
        }
      ]);

      // Generate preview
      await generatePreview(file);
      
      // Initialize compression settings
      if (format === 'JPG' || format === 'JPEG' || format === 'PNG') {
        setCompressionSettings(prev => ({
          ...prev,
          [file.name]: { quality: 80 }
        }));
      } else if (format === 'PDF') {
        setCompressionSettings(prev => ({
          ...prev,
          [file.name]: { level: 'medium' }
        }));
      }
      
      setError(null);
    } catch (err) {
      console.error('Error detecting file format:', err);
      setError(`Error processing ${file.name}`);
    }
  };
  
  // Handle compression setting change
  const handleCompressionChange = (fileName, value) => {
    setCompressionSettings(prev => ({
      ...prev,
      [fileName]: {
        ...(prev[fileName] || {}),
        ...(typeof value === 'number' ? { quality: value } : { level: value })
      }
    }));
  };
  
  // Update the conversion function to include compression settings
  const convertFiles = async () => {
    setIsLoading(true);
    setProgress(0);
    setConversionResults([]);
    setError(null);
    
    try {
      const formData = new FormData();
      
      files.forEach((file, index) => {
        formData.append('files', file);
        formData.append(`outputFormats[${index}]`, fileInfos[index].outputFormat);
        formData.append(`compression[${index}]`, JSON.stringify(compressionSettings[file.name] || {}));
      });
      
      const backendUrl = process.env.REACT_APP_BACKEND_URL;
      const response = await fetch(`${backendUrl}/convert`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Conversion failed');
      }
      
      const results = await response.json();
      // Add the backend URL to the download links
      const resultsWithFullUrls = results.map(result => ({
        ...result,
        downloadLink: result.downloadLink ? `${backendUrl}${result.downloadLink}` : null
      }));
      setConversionResults(resultsWithFullUrls);
      setConversionComplete(true);
    } catch (err) {
      console.error('Error during conversion:', err);
      setError('Conversion failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Update the download link handler
  const handleDownload = async (downloadUrl, filename) => {
    try {
      console.log('Downloading from URL:', downloadUrl);
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'Accept': '*/*',
        },
      });
      
      if (!response.ok) {
        console.error('Download failed:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      
      // Get the blob from the response
      const blob = await response.blob();
      console.log('Downloaded blob:', blob);
      
      // Create a temporary link and trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);
    } catch (err) {
      console.error('Download error:', err);
      setError(`Error downloading file: ${err.message}`);
    }
  };
  
  // Prevent default behavior for drag events
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  return (
    <div className="app-container">
      <h1 className="title">File Format Detector & Converter</h1>
      
      {!isBackendConnected && (
        <div className="error-message">
          Warning: Cannot connect to backend service. Please check if the service is running.
        </div>
      )}
      
      {/* Upload section */}
      <div className="upload-section">
        <div 
          className="drop-zone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <p className="drop-text">Drop Files Here</p>
          
          <div className="upload-buttons">
            <label className="button button-secondary">
              Browse Local Files
              <input 
                type="file" 
                multiple
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </label>
            
            <button
              className="button button-secondary"
              onClick={handleOpenPicker}
            >
              Upload from Google Drive
            </button>
          </div>
        </div>
      </div>
      
      {/* Error message */}
      {error && <p className="error-message">{error}</p>}
      
      {/* Progress section */}
      {isLoading && (
        <div className="progress-section">
          <p className="progress-message">
            {conversionComplete ? 'Conversion Complete!' : `Processing: ${progress}%`}
          </p>
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="progress-text">{progress}%</p>
          </div>
          
          {/* Individual file progress */}
          <div className="file-progress-list">
            {fileInfos.map(info => (
              <div key={info.name} className="file-progress-item">
                <span className="file-name">{info.name}</span>
                <div className="file-progress-bar">
                  <div 
                    className="progress-fill"
                    style={{ width: `${info.progress || 0}%` }}
                  />
                </div>
                <span className="progress-percentage">
                  {info.progress || 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* File list */}
      {fileInfos.length > 0 && (
        <div className="file-list">
          {fileInfos.map((fileInfo, index) => (
            <div key={fileInfo.name} className="file-item">
              <div className="file-info">
                <span className="file-name">{fileInfo.name}</span>
                <button
                  className="remove-button"
                  onClick={() => {
                    setFiles(prev => prev.filter((_, i) => i !== index));
                    setFileInfos(prev => prev.filter((_, i) => i !== index));
                  }}
                >
                  ×
                </button>
              </div>
              
              {/* File Preview */}
              {(previews[fileInfo.name] || pdfPreviews[fileInfo.name]) && (
                <div className="preview-container">
                  <img
                    src={previews[fileInfo.name] || pdfPreviews[fileInfo.name]}
                    alt={`Preview of ${fileInfo.name}`}
                    className="preview-image"
                  />
                </div>
              )}
              
              <div className="conversion-controls">
                <select
                  className="format-select"
                  value={fileInfo.outputFormat}
                  onChange={(e) => {
                    const newFileInfos = [...fileInfos];
                    newFileInfos[index].outputFormat = e.target.value;
                    setFileInfos(newFileInfos);
                  }}
                >
                  <option value="">Select output format</option>
                  {getConversionOptions(fileInfo.format).map(format => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
                
                {/* Compression Controls */}
                {(fileInfo.format === 'JPG' || fileInfo.format === 'JPEG' || fileInfo.format === 'PNG') && (
                  <div className="compression-control">
                    <label>Quality: {compressionSettings[fileInfo.name]?.quality || 80}%</label>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={compressionSettings[fileInfo.name]?.quality || 80}
                      onChange={(e) => handleCompressionChange(fileInfo.name, parseInt(e.target.value))}
                      className="quality-slider"
                    />
                  </div>
                )}
                
                {fileInfo.format === 'PDF' && (
                  <div className="compression-control">
                    <select
                      className="compression-select"
                      value={compressionSettings[fileInfo.name]?.level || 'medium'}
                      onChange={(e) => handleCompressionChange(fileInfo.name, e.target.value)}
                    >
                      <option value="low">Low Compression</option>
                      <option value="medium">Medium Compression</option>
                      <option value="high">High Compression</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          <button
            className="button button-primary convert-all"
            onClick={convertFiles}
            disabled={isLoading || !isBackendConnected || fileInfos.length === 0}
          >
            {isLoading ? 'Converting...' : 'Convert All Files'}
          </button>
        </div>
      )}
      
      {/* Conversion Results */}
      {conversionComplete && conversionResults.length > 0 && (
        <div className="file-list">
          {conversionResults.map((result, index) => (
            <div key={index} className="file-item">
              <div className="file-info">
                <span className="file-name">{result.filename}</span>
                <span className={`status-${result.status}`}>
                  {result.status}
                </span>
              </div>
              {result.status === 'success' && (
                <div className="download-section">
                  <a
                    href={result.downloadLink}
                    className="button button-primary"
                    download
                  >
                    Download
                  </a>
                  <button
                    className="button button-secondary"
                    onClick={() => handleSaveToGoogleDrive(result.downloadLink, result.filename)}
                  >
                    Save to Google Drive
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App; 