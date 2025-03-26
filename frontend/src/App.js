import React, { useState, useCallback, useEffect } from 'react';
import './App.css';

function App() {
  const [files, setFiles] = useState([]);
  const [fileInfos, setFileInfos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [conversionResults, setConversionResults] = useState([]);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  
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
  
  // Detect file format
  const detectFileFormat = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const backendUrl = process.env.REACT_APP_BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }
      
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
    
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8080';
      console.log('Using backend URL:', backendUrl);
      
      const formData = new FormData();
      fileInfos.forEach((info, index) => {
        formData.append('files', info.file);
        formData.append(`format_${index}`, info.selectedFormat);
      });
      
      const response = await fetch(`${backendUrl}/convert-batch`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Conversion failed');
      }
      
      const data = await response.json();
      console.log('Conversion response:', data);
      
      // Calculate overall progress based on individual file progress
      const totalProgress = Math.round(
        data.results.reduce((sum, result) => sum + (result.progress || 0), 0) / data.results.length
      );
      setProgress(totalProgress);
      
      // Update file infos with results and progress
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
      
      setConversionResults(data.results);
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
    <div style={styles.container}>
      <h1 style={styles.title}>File Format Detector & Converter</h1>
      
      {!isBackendConnected && (
        <div style={styles.errorMessage}>
          Warning: Cannot connect to backend service. Please check if the service is running.
        </div>
      )}
      
      {/* Drop zone */}
      <div 
        style={styles.dropZone}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <p style={styles.dropText}>Drop Files Here</p>
        
        {/* Browse button */}
        <label style={styles.browseButton}>
          Browse
          <input 
            type="file" 
            multiple
            style={styles.fileInput} 
            onChange={handleFileSelect}
          />
        </label>
      </div>
      
      {/* Loading indicator and progress bar */}
      {isLoading && (
        <div style={styles.progressSection}>
          <p style={styles.message}>Converting files...</p>
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${progress}%`
              }}
            />
          </div>
          <p style={styles.progressText}>{progress}%</p>
        </div>
      )}
      
      {/* Error message */}
      {error && <p style={styles.errorMessage}>{error}</p>}
      
      {/* File list */}
      {fileInfos.length > 0 && (
        <div style={styles.fileList}>
          {fileInfos.map(info => (
            <div key={info.id} style={styles.fileItem}>
              <div style={styles.fileInfo}>
                <span style={styles.fileName}>
                  {info.name} ({info.format})
                </span>
                <button
                  style={styles.removeButton}
                  onClick={() => handleRemoveFile(info.id)}
                  disabled={isLoading}
                >
                  ×
                </button>
              </div>
              
              {info.status === 'pending' ? (
                <div style={styles.conversionControls}>
                  <select
                    value={info.selectedFormat}
                    onChange={(e) => handleFormatChange(info.id, e.target.value)}
                    style={styles.select}
                    disabled={isLoading}
                  >
                    {getConversionOptions(info.format).map(format => (
                      <option key={format} value={format}>
                        Convert to {format}
                      </option>
                    ))}
                  </select>
                  {isLoading && (
                    <div style={styles.individualProgress}>
                      Converting: {info.progress || 0}%
                    </div>
                  )}
                </div>
              ) : info.status === 'success' ? (
                <button
                  onClick={() => handleDownload(info.downloadUrl, `${info.name.split('.')[0]}.${info.selectedFormat.toLowerCase()}`)}
                  style={styles.downloadButton}
                  className="fadeIn"
                >
                  Download {info.selectedFormat} File
                </button>
              ) : (
                <p style={styles.errorText}>{info.error}</p>
              )}
            </div>
          ))}
          
          {/* Convert All button */}
          <button
            style={styles.convertAllButton}
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

// Styles
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontFamily: 'Arial, sans-serif',
    padding: '20px',
  },
  title: {
    color: '#333333',
    marginBottom: '20px',
  },
  dropZone: {
    border: '2px dashed #cccccc',
    borderRadius: '5px',
    padding: '20px',
    width: '400px',
    height: '200px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropText: {
    fontSize: '18px',
    color: '#333333',
    marginBottom: '20px',
  },
  browseButton: {
    backgroundColor: '#dddddd',
    padding: '5px 10px',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  fileInput: {
    display: 'none',
  },
  message: {
    marginTop: '20px',
    fontSize: '16px',
    color: '#666666',
  },
  errorMessage: {
    marginTop: '20px',
    fontSize: '16px',
    color: '#ff0000',
    fontWeight: 'bold',
  },
  resultMessage: {
    marginTop: '20px',
    fontSize: '16px',
    color: '#008000',
    fontWeight: 'bold',
  },
  conversionSection: {
    marginTop: '20px',
    width: '100%',
    maxWidth: '400px',
  },
  conversionControls: {
    display: 'flex',
    gap: '10px',
    marginTop: '10px',
  },
  select: {
    flex: 1,
    padding: '8px',
    borderRadius: '5px',
    border: '1px solid #cccccc',
    fontSize: '16px',
  },
  convertButton: {
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  downloadButton: {
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    marginTop: '8px',
    width: '100%',
    textAlign: 'center',
    textDecoration: 'none',
    display: 'block',
  },
  fileList: {
    width: '100%',
    maxWidth: '600px',
    marginTop: '20px',
  },
  fileItem: {
    border: '1px solid #cccccc',
    borderRadius: '5px',
    padding: '10px',
    marginBottom: '10px',
  },
  fileInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  fileName: {
    fontSize: '16px',
    color: '#333333',
  },
  removeButton: {
    backgroundColor: '#ff4444',
    color: 'white',
    border: 'none',
    borderRadius: '50%',
    width: '24px',
    height: '24px',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressSection: {
    width: '100%',
    maxWidth: '400px',
    marginTop: '20px',
  },
  progressBar: {
    width: '100%',
    height: '20px',
    backgroundColor: '#f0f0f0',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    transition: 'width 0.3s ease-in-out',
  },
  progressText: {
    textAlign: 'center',
    marginTop: '5px',
    color: '#666666',
  },
  convertAllButton: {
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '16px',
    marginTop: '20px',
    width: '100%',
  },
  errorText: {
    color: '#ff0000',
    margin: '5px 0',
    fontSize: '14px',
  },
  individualProgress: {
    marginTop: '8px',
    fontSize: '14px',
    color: '#666666',
  },
};

export default App; 