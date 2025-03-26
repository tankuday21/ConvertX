import React, { useState, useCallback, useEffect } from 'react';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [conversionOptions, setConversionOptions] = useState([]);
  const [selectedFormat, setSelectedFormat] = useState('');
  const [convertedFile, setConvertedFile] = useState(null);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  
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
        // Wait before retrying
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
  
  // Get conversion options based on file format
  const getConversionOptions = (format) => {
    switch (format) {
      case 'PDF':
        return ['DOCX', 'TXT'];
      case 'JPG':
        return ['PNG', 'BMP'];
      default:
        return [];
    }
  };
  
  // Handle file drop event
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      setFile(droppedFile);
      uploadFile(droppedFile);
    }
  }, []);
  
  // Handle file selection via browse button
  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      uploadFile(selectedFile);
    }
  };
  
  // Prevent default behavior for drag events
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  // Upload file to backend for format detection
  const uploadFile = async (file) => {
    setIsLoading(true);
    setError(null);
    setConvertedFile(null);
    
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
      
      setFileInfo({
        name: file.name,
        format: data.format
      });
      
      const options = getConversionOptions(data.format);
      setConversionOptions(options);
      setSelectedFormat(options[0] || '');
    } catch (err) {
      console.error('Upload error:', err);
      setError(`Error: ${err.message}`);
      // Try to reconnect to backend
      checkBackendConnection();
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle file conversion
  const handleConvert = async () => {
    if (!file || !selectedFormat) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('outputFormat', selectedFormat);
      
      const backendUrl = process.env.REACT_APP_BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }
      
      const data = await makeApiCall(`${backendUrl}/convert`, {
        method: 'POST',
        body: formData,
      });
      
      setConvertedFile({
        url: `${backendUrl}${data.downloadUrl}`,
        format: selectedFormat
      });
    } catch (err) {
      console.error('Conversion error:', err);
      setError(`Error: ${err.message}`);
      // Try to reconnect to backend
      checkBackendConnection();
    } finally {
      setIsLoading(false);
    }
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
            style={styles.fileInput} 
            onChange={handleFileSelect}
          />
        </label>
      </div>
      
      {/* Loading indicator */}
      {isLoading && <p style={styles.message}>Processing...</p>}
      
      {/* Error message */}
      {error && <p style={styles.errorMessage}>{error}</p>}
      
      {/* File info and conversion options */}
      {fileInfo && !isLoading && (
        <div style={styles.conversionSection}>
          <p style={styles.resultMessage} className="fadeIn">
            File Uploaded: {fileInfo.name} ({fileInfo.format})
          </p>
          
          {conversionOptions.length > 0 && (
            <div style={styles.conversionControls}>
              <select 
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value)}
                style={styles.select}
              >
                {conversionOptions.map(format => (
                  <option key={format} value={format}>
                    Convert to {format}
                  </option>
                ))}
              </select>
              
              <button 
                onClick={handleConvert}
                style={styles.convertButton}
                disabled={isLoading}
              >
                Convert
              </button>
            </div>
          )}
          
          {/* Download button for converted file */}
          {convertedFile && (
            <a 
              href={convertedFile.url}
              download
              style={styles.downloadButton}
              className="fadeIn"
            >
              Download Converted File ({convertedFile.format})
            </a>
          )}
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
    display: 'block',
    backgroundColor: '#2196F3',
    color: 'white',
    textDecoration: 'none',
    padding: '8px 16px',
    borderRadius: '5px',
    marginTop: '10px',
    textAlign: 'center',
    fontSize: '16px',
  },
};

export default App; 