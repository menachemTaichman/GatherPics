import { BlobReader, HttpReader, ZipWriter } from '@zip.js/zip.js';
import * as streamSaver from 'streamsaver';

// Configure StreamSaver mitm (required for large file streaming)
if (typeof window !== 'undefined') {
  if (window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html';
  }
}

/**
 * Download images as ZIP using streaming
 * @param {Promise<Array> | Array} filesOrPromise - Files array OR a Promise that resolves to it
 * @param {string} zipFilename
 * @param {Function} onProgress
 */
export async function downloadAsZip(filesOrPromise, zipFilename = 'images.zip', onProgress = null) {
  // 1. Create MessageChannel for StreamSaver mitm communication (REQUIRED when using mitm)
  const messageChannel = new MessageChannel();
  
  // 2. Create write stream with messageChannel.port2 as third argument
  // This is required for mitm.html to receive the channel
  let fileStream;
  try {
    fileStream = streamSaver.createWriteStream(
      zipFilename,
      {
        size: undefined, // Unknown size for streaming
      },
      messageChannel.port2  // Pass port2 to mitm
    );
  } catch (error) {
    console.error('Failed to create write stream:', error);
    throw error;
  }

  try {
    // 3. Now get files (after stream is created)
    const files = Array.isArray(filesOrPromise) ? filesOrPromise : await filesOrPromise;

    if (!files || files.length === 0) {
      // Close the stream if no files
      const writer = fileStream.getWriter();
      await writer.close();
      throw new Error('No files to download');
    }

    // Pass fileStream directly to ZipWriter - it should handle WritableStream
    const zipWriter = new ZipWriter(fileStream, { 
      bufferedWrite: false,  // Streaming - writes incrementally
      useWebWorkers: false 
    });

    const total = files.length;
    let current = 0;
    let errorLog = '';

    for (const file of files) {
      try {
        // HttpReader streams directly from URL - no memory download
        await zipWriter.add(file.filename, new HttpReader(file.url));
        
        current++;
        if (onProgress) {
          onProgress(current, total, file.filename);
        }
      } catch (err) {
        console.error(`Failed to pack ${file.filename}:`, err);
        errorLog += `Failed: ${file.filename} - ${err.message}\n`;
      }
    }

    if (errorLog) {
      try {
        await zipWriter.add('error_log.txt', new BlobReader(new Blob([errorLog], { type: 'text/plain' })));
      } catch (e) {
        console.error('Failed to add error log:', e);
      }
    }

    await zipWriter.close();
    
    if (onProgress) {
      onProgress(total, total, 'Complete');
    }

  } catch (error) {
    // Try to close stream on error
    try { 
      if (fileStream) {
        const writer = fileStream.getWriter();
        await writer.close();
      }
    } catch (e) {
      console.error('Error closing stream:', e);
    }
    throw error;
  }
}
