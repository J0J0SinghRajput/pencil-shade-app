import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';

// Pencil grade definitions mapping to image processing parameters
const PENCIL_GRADES = {
  'HB':  { blur: 3, multiplyAlpha: 0.1, contrast: 0.85, brightness: 1.15, label: 'HB (Lightest)' },
  '2B':  { blur: 4, multiplyAlpha: 0.25, contrast: 1.0, brightness: 1.0, label: '2B (Standard)' },
  '4B':  { blur: 5, multiplyAlpha: 0.45, contrast: 1.1, brightness: 0.9, label: '4B (Dark)' },
  '6B':  { blur: 6, multiplyAlpha: 0.65, contrast: 1.2, brightness: 0.8, label: '6B (Very Dark)' },
  '8B':  { blur: 7, multiplyAlpha: 0.85, contrast: 1.3, brightness: 0.7, label: '8B (Charcoal-like)' },
  '10B': { blur: 8, multiplyAlpha: 1.0,  contrast: 1.5, brightness: 0.6, label: '10B (Pitch Black)' },
};

const MAX_IMAGE_DIMENSION = 2000; // Cap resolution to prevent mobile browser crashes

export default function App() {
  const [imageSrc, setImageSrc] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [selectedGrade, setSelectedGrade] = useState('2B');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const noiseCanvasRef = useRef(null);

  // Generate a reusable noise pattern for paper texture
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(256, 256);
    
    for (let i = 0; i < imgData.data.length; i += 4) {
      const val = Math.random() * 255;
      imgData.data[i] = val;     // R
      imgData.data[i + 1] = val; // G
      imgData.data[i + 2] = val; // B
      imgData.data[i + 3] = 15;  // Low opacity noise
    }
    
    ctx.putImageData(imgData, 0, 0);
    noiseCanvasRef.current = canvas;
  }, []);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Downscale image if it's too large to prevent canvas out-of-memory errors
        let width = img.width;
        let height = img.height;
        
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        const ctx = offscreenCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const optimizedImage = new Image();
        optimizedImage.onload = () => {
          setImageData({ img: optimizedImage, width, height });
          setImageSrc(optimizedImage.src);
        };
        optimizedImage.src = offscreenCanvas.toDataURL('image/jpeg', 0.9);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const processImage = useCallback(() => {
    if (!imageData || !canvasRef.current) return;

    const { img, width, height } = imageData;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const gradeProps = PENCIL_GRADES[selectedGrade];

    canvas.width = width;
    canvas.height = height;

    // 1. Base Grayscale Layer
    const canvasBase = document.createElement('canvas');
    canvasBase.width = width;
    canvasBase.height = height;
    const ctxBase = canvasBase.getContext('2d');
    ctxBase.filter = 'grayscale(100%)';
    ctxBase.drawImage(img, 0, 0, width, height);

    // 2. Inverted & Blurred Layer
    const canvasBlur = document.createElement('canvas');
    canvasBlur.width = width;
    canvasBlur.height = height;
    const ctxBlur = canvasBlur.getContext('2d');
    
    // Scale blur radius based on image size to maintain consistent look
    const dynamicBlur = Math.max(1, gradeProps.blur * (Math.max(width, height) / 1000));
    ctxBlur.filter = `grayscale(100%) invert(100%) blur(${dynamicBlur}px)`;
    ctxBlur.drawImage(img, 0, 0, width, height);

    // 3. Sketch Blend (Color Dodge)
    const canvasSketch = document.createElement('canvas');
    canvasSketch.width = width;
    canvasSketch.height = height;
    const ctxSketch = canvasSketch.getContext('2d');
    
    ctxSketch.drawImage(canvasBase, 0, 0, width, height);
    ctxSketch.globalCompositeOperation = 'color-dodge';
    ctxSketch.drawImage(canvasBlur, 0, 0, width, height);

    // 4. Blend shadows back in to simulate different pencil darkness
    ctxSketch.globalCompositeOperation = 'multiply';
    ctxSketch.globalAlpha = gradeProps.multiplyAlpha;
    ctxSketch.drawImage(canvasBase, 0, 0, width, height);

    // 5. Add Paper Texture (Noise)
    if (noiseCanvasRef.current) {
      ctxSketch.globalAlpha = 0.5;
      ctxSketch.fillStyle = ctxSketch.createPattern(noiseCanvasRef.current, 'repeat');
      ctxSketch.fillRect(0, 0, width, height);
    }

    // 6. Draw Final to Main Canvas with Contrast & Brightness correction
    ctx.filter = `contrast(${gradeProps.contrast}) brightness(${gradeProps.brightness})`;
    ctx.drawImage(canvasSketch, 0, 0, width, height);

  }, [imageData, selectedGrade]);

  // Trigger processing when image or grade changes, yielding to main thread first for UI updates
  useEffect(() => {
    if (imageData) {
      setIsProcessing(true);
      const timer = setTimeout(() => {
        processImage();
        setIsProcessing(false);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [imageData, selectedGrade, processImage]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `pencil-sketch-${selectedGrade}.jpg`;
    link.href = canvasRef.current.toDataURL('image/jpeg', 0.9);
    link.click();
  };

  const clearImage = () => {
    setImageSrc(null);
    setImageData(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-800 font-sans p-4 md:p-8 flex flex-col items-center">
      
      {/* Header */}
      <div className="w-full max-w-5xl mb-8 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-neutral-900 mb-3">
          Pencil Studio
        </h1>
        <p className="text-neutral-500 text-lg">
          Transform your photos into realistic graphite sketches from HB to 10B.
        </p>
      </div>

      <div className="w-full max-w-5xl bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Left/Top Area: Canvas & Image Upload */}
        <div className="flex-1 bg-neutral-200/50 p-6 flex flex-col items-center justify-center min-h-[400px] relative border-b md:border-b-0 md:border-r border-neutral-200">
          
          {!imageSrc ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-neutral-300 rounded-2xl w-full h-full min-h-[400px] flex flex-col items-center justify-center cursor-pointer hover:bg-neutral-100 transition-colors group"
            >
              <div className="bg-white p-4 rounded-full shadow-sm mb-4 group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8 text-neutral-500" />
              </div>
              <p className="font-medium text-neutral-600">Click or tap to upload a photo</p>
              <p className="text-sm text-neutral-400 mt-1">Supports JPG, PNG, WEBP</p>
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Canvas that displays the processed image */}
              <canvas 
                ref={canvasRef} 
                className={`max-w-full rounded-xl shadow-lg transition-opacity duration-300 ${isProcessing ? 'opacity-50' : 'opacity-100'}`}
                style={{ maxHeight: '65vh', objectFit: 'contain' }}
              />
              
              {/* Loading Overlay */}
              {isProcessing && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-white/80 backdrop-blur-sm p-4 rounded-full shadow-lg flex items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-neutral-800" />
                    <span className="font-medium text-neutral-800 pr-2">Drawing...</span>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Hidden File Input */}
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleImageUpload} 
            accept="image/*" 
            className="hidden" 
          />
        </div>

        {/* Right/Bottom Area: Controls */}
        <div className="w-full md:w-80 p-6 md:p-8 flex flex-col bg-white">
          
          <h2 className="text-xl font-bold mb-6 text-neutral-800 flex items-center gap-2">
            <ImageIcon className="w-5 h-5" /> Adjust Pencil
          </h2>

          <div className="flex-1 space-y-6">
            
            {/* Grade Selection */}
            <div>
              <label className="block text-sm font-semibold text-neutral-500 mb-3 uppercase tracking-wider">
                Pencil Grade
              </label>
              <div className="grid grid-cols-2 gap-3">
                {Object.keys(PENCIL_GRADES).map((grade) => (
                  <button
                    key={grade}
                    onClick={() => setSelectedGrade(grade)}
                    disabled={!imageSrc}
                    className={`py-3 px-2 rounded-xl border-2 transition-all font-medium flex flex-col items-center justify-center gap-1
                      ${!imageSrc ? 'opacity-50 cursor-not-allowed border-neutral-100 bg-neutral-50' : ''}
                      ${selectedGrade === grade 
                        ? 'border-neutral-900 bg-neutral-900 text-white shadow-md' 
                        : 'border-neutral-200 hover:border-neutral-400 bg-white text-neutral-700'
                      }`}
                  >
                    <span className="text-lg">{grade}</span>
                  </button>
                ))}
              </div>
              <p className="text-sm text-neutral-500 mt-4 text-center italic">
                {PENCIL_GRADES[selectedGrade].label}
              </p>
            </div>
            
          </div>

          {/* Action Buttons */}
          <div className="mt-8 space-y-3">
            <button
              onClick={handleDownload}
              disabled={!imageSrc || isProcessing}
              className="w-full py-4 rounded-xl font-bold bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-neutral-900/20 transition-all active:scale-[0.98]"
            >
              <Download className="w-5 h-5" />
              Download Sketch
            </button>
            
            {imageSrc && (
              <button
                onClick={clearImage}
                disabled={isProcessing}
                className="w-full py-3 rounded-xl font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Start Over
              </button>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}
