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
  
  // Generate file preview
  const generatePreview = async (file) => {
    try {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviews(prev => ({
            ...prev,
            [file.name]: e.target.result
          }));
        };
        reader.readAsDataURL(file);
      } else if (file.type === 'application/pdf') {
        const url = URL.createObjectURL(file);
        setPreviews(prev => ({
          ...prev,
          [file.name]: url
        }));
      }
    } catch (err) {
      console.error('Error generating preview:', err);
    }
  };
  
  // Handle file upload (both local and Google Drive)
  const handleFileUpload = async (file) => {
    await generatePreview(file);
    detectFileFormat(file);
  };
  
  // Detect file format
  const detectFileFormat = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8080';
      
      const data = await makeApiCall(`${backendUrl}/detect`, {
        method: 'POST',
        body: formData,
      });
      
      const fileInfo = {
        id: Math.random().toString(36).substr(2, 9),
        file,
        name: file.name,
        format: data.format,
        selectedFormat: getConversionOptions(data.format)[0] || '',
        compression: getDefaultCompression(data.format),
        status: 'pending',
        error: null,
        downloadUrl: null
      };
      
      setFileInfos(prevInfos => [...prevInfos, fileInfo]);
    } catch (err) {
      console.error('Format detection error:', err);
      setError(`Error detecting format for ${file.name}: ${err.message}`);
    }
  };
  
  // Get default compression settings based on format
  const getDefaultCompression = (format) => {
    switch (format.toUpperCase()) {
      case 'PDF':
        return 'medium';
      case 'JPG':
      case 'JPEG':
      case 'PNG':
      case 'BMP':
        return 80;
      default:
        return null;
    }
  };
  
  // Handle compression change
  const handleCompressionChange = (id, value) => {
    setFileInfos(prevInfos =>
      prevInfos.map(info =>
        info.id === id ? { ...info, compression: value } : info
      )
    );
  };
  
  // Handle format selection change
  const handleFormatChange = (id, format) => {
    setFileInfos(prevInfos =>
      prevInfos.map(info =>
        info.id === id ? { ...info, selectedFormat: format } : info
      )
    );
  };
  
  // Remove file from list
  const handleRemoveFile = (id) => {
    setFileInfos(prevInfos => prevInfos.filter(info => info.id !== id));
    setFiles(prevFiles => prevFiles.filter((_, index) => 
      fileInfos.findIndex(info => info.id === id) !== index
    ));
  };
  
  // Convert all files
  const handleConvertAll = async () => {
    if (fileInfos.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    setProgress(0);
    setConversionResults([]);
    setConversionComplete(false);
    
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8080';
      console.log('Using backend URL:', backendUrl);
      
      const formData = new FormData();
      fileInfos.forEach((info, index) => {
        formData.append('files', info.file);
        formData.append(`format_${index}`, info.selectedFormat);
        formData.append(`compression_${index}`, info.compression);
      });
      
      const response = await fetch(`${backendUrl}/convert-batch`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Conversion failed');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalProcessed = 0;
      const totalFiles = fileInfos.length;
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Split buffer by newlines to handle multiple JSON objects
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);
            console.log('Progress update:', data);
            
            // Update overall progress
            if (data.overall_progress !== undefined) {
              setProgress(Math.round(data.overall_progress));
            } else if (data.processed !== undefined) {
              // Calculate progress based on processed files
              totalProcessed = data.processed;
              const overallProgress = Math.round((totalProcessed / totalFiles) * 100);
              setProgress(overallProgress);
            }
            
            // Update individual file progress
            if (data.results) {
              setFileInfos(prevInfos =>
                prevInfos.map(info => {
                  const result = data.results.find(r => r.filename === info.name);
                  if (!result) return info;
                  
                  return {
                    ...info,
                    status: result.status,
                    error: result.error || null,
                    downloadUrl: result.downloadUrl ? `${backendUrl}${result.downloadUrl}` : null,
                    progress: result.progress || 0
                  };
                })
              );
            }
            
            // Check if all files are processed
            if (totalProcessed === totalFiles || data.overall_progress === 100) {
              setConversionComplete(true);
            }
          } catch (err) {
            console.error('Error parsing progress update:', err, 'Line:', line);
          }
        }
      }
      
      // Ensure progress is 100% and conversion is marked as complete
      setProgress(100);
      setConversionComplete(true);
      
    } catch (err) {
      console.error('Batch conversion error:', err);
      setError(`Error converting files: ${err.message}`);
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
              <div key={info.id} className="file-progress-item">
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
          {fileInfos.map(info => (
            <div key={info.id} className="file-item">
              {/* Preview section */}
              {previews[info.name] && (
                <div className="preview-container">
                  {info.file.type.startsWith('image/') ? (
                    <img
                      src={previews[info.name]}
                      alt={info.name}
                      className="preview-image"
                    />
                  ) : info.file.type === 'application/pdf' && (
                    <Document file={previews[info.name]}>
                      <Page pageNumber={1} width={200} />
                    </Document>
                  )}
                </div>
              )}
              
              <div className="file-info">
                <span className="file-name">
                  {info.name} ({info.format})
                </span>
                <button
                  className="remove-button"
                  onClick={() => handleRemoveFile(info.id)}
                  disabled={isLoading}
                >
                  ×
                </button>
              </div>
              
              {info.status === 'pending' ? (
                <div className="conversion-controls">
                  <select
                    value={info.selectedFormat}
                    onChange={(e) => handleFormatChange(info.id, e.target.value)}
                    className="format-select"
                    disabled={isLoading}
                  >
                    {getConversionOptions(info.format).map(format => (
                      <option key={format} value={format}>
                        Convert to {format}
                      </option>
                    ))}
                  </select>
                  
                  {/* Compression options */}
                  {info.compression !== null && (
                    <div className="compression-control">
                      {typeof info.compression === 'number' ? (
                        <>
                          <label>Quality: {info.compression}%</label>
                          <input
                            type="range"
                            min="10"
                            max="100"
                            value={info.compression}
                            onChange={(e) => handleCompressionChange(info.id, parseInt(e.target.value))}
                            disabled={isLoading}
                            className="quality-slider"
                          />
                        </>
                      ) : (
                        <select
                          value={info.compression}
                          onChange={(e) => handleCompressionChange(info.id, e.target.value)}
                          className="compression-select"
                          disabled={isLoading}
                        >
                          <option value="low">Low Compression</option>
                          <option value="medium">Medium Compression</option>
                          <option value="high">High Compression</option>
                        </select>
                      )}
                    </div>
                  )}
                </div>
              ) : info.status === 'success' ? (
                <div className="download-section">
                  <button
                    onClick={() => handleDownload(info.downloadUrl, `${info.name.split('.')[0]}.${info.selectedFormat.toLowerCase()}`)}
                    className="button button-primary"
                  >
                    Download {info.selectedFormat} File
                  </button>
                  <button
                    onClick={() => handleSaveToGoogleDrive(info.downloadUrl, `${info.name.split('.')[0]}.${info.selectedFormat.toLowerCase()}`)}
                    className="button button-secondary"
                  >
                    Save to Google Drive
                  </button>
                </div>
              ) : (
                <p className="error-text">{info.error}</p>
              )}
            </div>
          ))}
          
          {/* Convert All button */}
          <button
            className="button button-primary convert-all"
            onClick={handleConvertAll}
            disabled={isLoading || fileInfos.length === 0}
          >
            {isLoading ? 'Converting...' : 'Convert All Files'}
          </button>
        </div>
      )}
    </div>
  );
}

export default App; 