import { BlobReader, ZipWriter, Reader } from '@zip.js/zip.js';
import streamSaver from 'streamsaver';
import jwtService from './jwtService';

// Configure StreamSaver mitm
// Note: The external mitm proxy may make an unauthorized verification request (401 error in logs)
// This is harmless - the actual download requests include auth headers and succeed
if (typeof window !== 'undefined') {
  streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html';
}

/**
 * Custom Reader that wraps a standard ReadableStream (from fetch)
 * Fixed to handle stream termination correctly.
 */
class CustomStreamReader extends Reader {
  constructor(readableStream, size) {
    super();
    this.readableStream = readableStream;
    this.size = size;
    this.reader = readableStream.getReader();
    this.buffer = new Uint8Array(0);
    this.streamEnded = false;
  }

  async readUint8Array(offset, length) {
    // zip.js requests data chunks sequentially.
    // We need to keep reading from the stream until we have enough data in our buffer.
    
    while (this.buffer.length < length && !this.streamEnded) {
      const { done, value } = await this.reader.read();
      
      if (done) {
        this.streamEnded = true;
        break;
      }
      
      if (value) {
        // Append new chunk to existing buffer
        const newBuffer = new Uint8Array(this.buffer.length + value.length);
        newBuffer.set(this.buffer);
        newBuffer.set(value, this.buffer.length);
        this.buffer = newBuffer;
      }
    }

    // If we have no data left and stream is ended, return empty array (EOF)
    if (this.buffer.length === 0 && this.streamEnded) {
      return new Uint8Array(0);
    }

    // Extract the requested chunk
    // Note: We ignore the 'offset' param because we assume sequential reads for streaming
    const readLength = Math.min(length, this.buffer.length);
    const chunk = this.buffer.slice(0, readLength);
    
    // Remove read data from buffer (slide window)
    this.buffer = this.buffer.slice(readLength);
    
    return chunk;
  }
}

/**
 * Download images as ZIP using streaming
 */
export async function downloadAsZip(filesOrPromise, zipFilename = 'images.zip', onProgress = null) {
  // 1. Create MessageChannel
  const messageChannel = new MessageChannel();
  
  // 2. Create write stream
  const fileStream = streamSaver.createWriteStream(
    zipFilename,
    { size: undefined },
    messageChannel.port2
  );

  try {
    const files = Array.isArray(filesOrPromise) ? filesOrPromise : await filesOrPromise;

    if (!files || files.length === 0) {
      const writer = fileStream.getWriter();
      await writer.close();
      throw new Error('No files to download');
    }

    // 3. Setup ZipWriter
    const zipWriter = new ZipWriter(fileStream, { 
      bufferedWrite: false, 
      useWebWorkers: false 
    });

    const total = files.length;
    let current = 0;
    let errorLog = '';

    for (const file of files) {
      try {
        const isR2SignedUrl = file.url.includes('r2.cloudflarestorage.com') || 
                             file.url.includes('X-Amz-Signature') ||
                             file.url.includes('X-Amz-Algorithm');

        const fetchOptions = {};
        
        if (isR2SignedUrl) {
          // R2 Signed URL strategy:
          // 1. No Authorization header (auth is in query params)
          // 2. No credentials (cookies) -> This is CRITICAL to avoid Preflight if possible
          fetchOptions.credentials = 'omit'; 
        } else {
          // API Strategy:
          const token = jwtService.getTokenSync();
          fetchOptions.credentials = 'include';
          if (token) {
            fetchOptions.headers = { 'Authorization': `Bearer ${token}` };
          }
        }

        // ביצוע הבקשה
        const response = await fetch(file.url, fetchOptions);
        
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        // 5. Use our FIXED Custom Reader
        const streamReader = new CustomStreamReader(
          response.body, 
          file.size || 0
        );

        // 6. Add to ZIP
        await zipWriter.add(file.filename, streamReader);
        
        current++;
        if (onProgress) onProgress(current, total, file.filename);
        
      } catch (err) {
        console.error(`Failed to pack ${file.filename}:`, err);
        errorLog += `Failed: ${file.filename} - ${err.message}\n`;
      }
    }

    if (errorLog) {
      try {
        await zipWriter.add('error_log.txt', new BlobReader(new Blob([errorLog], { type: 'text/plain' })));
      } catch (e) {}
    }

    await zipWriter.close();
    if (onProgress) onProgress(total, total, 'Complete');

  } catch (error) {
    try { 
      const writer = fileStream.getWriter();
      await writer.close();
    } catch (e) {}
    console.error('Download logic failed:', error);
    throw error;
  }
}