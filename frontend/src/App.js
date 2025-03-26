import React, { useState, useCallback } from 'react';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
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
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/detect`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to detect file format');
      }
      
      const data = await response.json();
      setFileInfo({
        name: file.name,
        format: data.format
      });
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>File Format Detector</h1>
      
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
      
      {/* Result message */}
      {fileInfo && !isLoading && (
        <p style={styles.resultMessage} className="fadeIn">
          File Uploaded: {fileInfo.name} ({fileInfo.format})
        </p>
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
};

export default App; 