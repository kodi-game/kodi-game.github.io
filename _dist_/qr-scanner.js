const _QrScanner = class {
  constructor(video, onDecode, canvasSizeOrOnDecodeErrorOrOptions, canvasSizeOrCalculateScanRegion, preferredCamera) {
    this._legacyCanvasSize = _QrScanner.DEFAULT_CANVAS_SIZE;
    this._preferredCamera = "environment";
    this._maxScansPerSecond = 25;
    this._lastScanTimestamp = -1;
    this._active = false;
    this._paused = false;
    this._flashOn = false;
    this._destroyed = false;
    this.$video = video;
    this.$canvas = document.createElement("canvas");
    if (canvasSizeOrOnDecodeErrorOrOptions && typeof canvasSizeOrOnDecodeErrorOrOptions === "object") {
      this._onDecode = onDecode;
    } else {
      if (canvasSizeOrOnDecodeErrorOrOptions || canvasSizeOrCalculateScanRegion || preferredCamera) {
        console.warn("You're using a deprecated version of the QrScanner constructor which will be removed in the future");
      } else {
        console.warn("Note that the type of the scan result passed to onDecode will change in the future. To already switch to the new api today, you can pass returnDetailedScanResult: true.");
      }
      this._legacyOnDecode = onDecode;
    }
    const options = typeof canvasSizeOrOnDecodeErrorOrOptions === "object" ? canvasSizeOrOnDecodeErrorOrOptions : {};
    this._onDecodeError = options.onDecodeError || (typeof canvasSizeOrOnDecodeErrorOrOptions === "function" ? canvasSizeOrOnDecodeErrorOrOptions : this._onDecodeError);
    this._calculateScanRegion = options.calculateScanRegion || (typeof canvasSizeOrCalculateScanRegion === "function" ? canvasSizeOrCalculateScanRegion : this._calculateScanRegion);
    this._preferredCamera = options.preferredCamera || preferredCamera || this._preferredCamera;
    this._legacyCanvasSize = typeof canvasSizeOrOnDecodeErrorOrOptions === "number" ? canvasSizeOrOnDecodeErrorOrOptions : typeof canvasSizeOrCalculateScanRegion === "number" ? canvasSizeOrCalculateScanRegion : this._legacyCanvasSize;
    this._maxScansPerSecond = options.maxScansPerSecond || this._maxScansPerSecond;
    this._onPlay = this._onPlay.bind(this);
    this._onLoadedMetaData = this._onLoadedMetaData.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._updateOverlay = this._updateOverlay.bind(this);
    video.disablePictureInPicture = true;
    video.playsInline = true;
    video.muted = true;
    let shouldHideVideo = false;
    if (video.hidden) {
      video.hidden = false;
      shouldHideVideo = true;
    }
    if (!document.body.contains(video)) {
      document.body.appendChild(video);
      shouldHideVideo = true;
    }
    const videoContainer = video.parentElement;
    if (options.highlightScanRegion || options.highlightCodeOutline) {
      const gotExternalOverlay = !!options.overlay;
      this.$overlay = options.overlay || document.createElement("div");
      const overlayStyle = this.$overlay.style;
      overlayStyle.position = "absolute";
      overlayStyle.display = "none";
      overlayStyle.pointerEvents = "none";
      this.$overlay.classList.add("scan-region-highlight");
      if (!gotExternalOverlay && options.highlightScanRegion) {
        this.$overlay.innerHTML = '<svg class="scan-region-highlight-svg" viewBox="0 0 238 238" preserveAspectRatio="none" style="position:absolute;width:100%;height:100%;left:0;top:0;fill:none;stroke:#e9b213;stroke-width:4;stroke-linecap:round;stroke-linejoin:round"><path d="M31 2H10a8 8 0 0 0-8 8v21M207 2h21a8 8 0 0 1 8 8v21m0 176v21a8 8 0 0 1-8 8h-21m-176 0H10a8 8 0 0 1-8-8v-21"/></svg>';
        try {
          this.$overlay.firstElementChild.animate({transform: ["scale(.98)", "scale(1.01)"]}, {
            duration: 400,
            iterations: Infinity,
            direction: "alternate",
            easing: "ease-in-out"
          });
        } catch (e) {
        }
        videoContainer.insertBefore(this.$overlay, this.$video.nextSibling);
      }
      if (options.highlightCodeOutline) {
        this.$overlay.insertAdjacentHTML("beforeend", '<svg class="code-outline-highlight" preserveAspectRatio="none" style="display:none;width:100%;height:100%;fill:none;stroke:#e9b213;stroke-width:5;stroke-dasharray:25;stroke-linecap:round;stroke-linejoin:round"><polygon/></svg>');
        this.$codeOutlineHighlight = this.$overlay.lastElementChild;
      }
    }
    this._scanRegion = this._calculateScanRegion(video);
    requestAnimationFrame(() => {
      const videoStyle = window.getComputedStyle(video);
      if (videoStyle.display === "none") {
        video.style.setProperty("display", "block", "important");
        shouldHideVideo = true;
      }
      if (videoStyle.visibility !== "visible") {
        video.style.setProperty("visibility", "visible", "important");
        shouldHideVideo = true;
      }
      if (shouldHideVideo) {
        console.warn("QrScanner has overwritten the video hiding style to avoid Safari stopping the playback.");
        video.style.opacity = "0";
        video.style.width = "0";
        video.style.height = "0";
        if (this.$overlay && this.$overlay.parentElement) {
          this.$overlay.parentElement.removeChild(this.$overlay);
        }
        delete this.$overlay;
        delete this.$codeOutlineHighlight;
      }
      if (this.$overlay) {
        this._updateOverlay();
      }
    });
    video.addEventListener("play", this._onPlay);
    video.addEventListener("loadedmetadata", this._onLoadedMetaData);
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    window.addEventListener("resize", this._updateOverlay);
    this._qrEnginePromise = _QrScanner.createQrEngine();
  }
  static set WORKER_PATH(workerPath) {
    console.warn("Setting QrScanner.WORKER_PATH is not required and not supported anymore. Have a look at the README for new setup instructions.");
  }
  static async hasCamera() {
    try {
      return !!(await _QrScanner.listCameras(false)).length;
    } catch (e) {
      return false;
    }
  }
  static async listCameras(requestLabels = false) {
    if (!navigator.mediaDevices)
      return [];
    const enumerateCameras = async () => (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    let openedStream;
    try {
      if (requestLabels && (await enumerateCameras()).every((camera) => !camera.label)) {
        openedStream = await navigator.mediaDevices.getUserMedia({audio: false, video: true});
      }
    } catch (e) {
    }
    try {
      return (await enumerateCameras()).map((camera, i) => ({
        id: camera.deviceId,
        label: camera.label || (i === 0 ? "Default Camera" : `Camera ${i + 1}`)
      }));
    } finally {
      if (openedStream) {
        console.warn("Call listCameras after successfully starting a QR scanner to avoid creating a temporary video stream");
        _QrScanner._stopVideoStream(openedStream);
      }
    }
  }
  async hasFlash() {
    let stream;
    try {
      if (this.$video.srcObject) {
        if (!(this.$video.srcObject instanceof MediaStream))
          return false;
        stream = this.$video.srcObject;
      } else {
        stream = (await this._getCameraStream()).stream;
      }
      return "torch" in stream.getVideoTracks()[0].getSettings();
    } catch (e) {
      return false;
    } finally {
      if (stream && stream !== this.$video.srcObject) {
        console.warn("Call hasFlash after successfully starting the scanner to avoid creating a temporary video stream");
        _QrScanner._stopVideoStream(stream);
      }
    }
  }
  isFlashOn() {
    return this._flashOn;
  }
  async toggleFlash() {
    if (this._flashOn) {
      await this.turnFlashOff();
    } else {
      await this.turnFlashOn();
    }
  }
  async turnFlashOn() {
    if (this._flashOn || this._destroyed)
      return;
    this._flashOn = true;
    if (!this._active || this._paused)
      return;
    try {
      if (!await this.hasFlash())
        throw "No flash available";
      await this.$video.srcObject.getVideoTracks()[0].applyConstraints({
        advanced: [{torch: true}]
      });
    } catch (e) {
      this._flashOn = false;
      throw e;
    }
  }
  async turnFlashOff() {
    if (!this._flashOn)
      return;
    this._flashOn = false;
    await this._restartVideoStream();
  }
  destroy() {
    this.$video.removeEventListener("loadedmetadata", this._onLoadedMetaData);
    this.$video.removeEventListener("play", this._onPlay);
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    window.removeEventListener("resize", this._updateOverlay);
    this._destroyed = true;
    this._flashOn = false;
    this.stop();
    _QrScanner._postWorkerMessage(this._qrEnginePromise, "close");
  }
  async start() {
    if (this._active && !this._paused || this._destroyed)
      return;
    if (window.location.protocol !== "https:") {
      console.warn("The camera stream is only accessible if the page is transferred via https.");
    }
    this._active = true;
    if (document.hidden)
      return;
    this._paused = false;
    if (this.$video.srcObject) {
      await this.$video.play();
      return;
    }
    try {
      const {stream, facingMode} = await this._getCameraStream();
      if (!this._active || this._paused) {
        _QrScanner._stopVideoStream(stream);
        return;
      }
      this._setVideoMirror(facingMode);
      this.$video.srcObject = stream;
      await this.$video.play();
      if (this._flashOn) {
        this._flashOn = false;
        this.turnFlashOn().catch(() => {
        });
      }
    } catch (e) {
      if (this._paused)
        return;
      this._active = false;
      throw e;
    }
  }
  stop() {
    this.pause();
    this._active = false;
  }
  async pause(stopStreamImmediately = false) {
    this._paused = true;
    if (!this._active)
      return true;
    this.$video.pause();
    if (this.$overlay) {
      this.$overlay.style.display = "none";
    }
    const stopStream = () => {
      if (this.$video.srcObject instanceof MediaStream) {
        _QrScanner._stopVideoStream(this.$video.srcObject);
        this.$video.srcObject = null;
      }
    };
    if (stopStreamImmediately) {
      stopStream();
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    if (!this._paused)
      return false;
    stopStream();
    return true;
  }
  async setCamera(facingModeOrDeviceId) {
    if (facingModeOrDeviceId === this._preferredCamera)
      return;
    this._preferredCamera = facingModeOrDeviceId;
    await this._restartVideoStream();
  }
  static async scanImage(imageOrFileOrBlobOrUrl, scanRegionOrOptions, qrEngine, canvas, disallowCanvasResizing = false, alsoTryWithoutScanRegion = false) {
    let scanRegion;
    let returnDetailedScanResult = false;
    if (scanRegionOrOptions && ("scanRegion" in scanRegionOrOptions || "qrEngine" in scanRegionOrOptions || "canvas" in scanRegionOrOptions || "disallowCanvasResizing" in scanRegionOrOptions || "alsoTryWithoutScanRegion" in scanRegionOrOptions || "returnDetailedScanResult" in scanRegionOrOptions)) {
      scanRegion = scanRegionOrOptions.scanRegion;
      qrEngine = scanRegionOrOptions.qrEngine;
      canvas = scanRegionOrOptions.canvas;
      disallowCanvasResizing = scanRegionOrOptions.disallowCanvasResizing || false;
      alsoTryWithoutScanRegion = scanRegionOrOptions.alsoTryWithoutScanRegion || false;
      returnDetailedScanResult = true;
    } else if (scanRegionOrOptions || qrEngine || canvas || disallowCanvasResizing || alsoTryWithoutScanRegion) {
      console.warn("You're using a deprecated api for scanImage which will be removed in the future.");
    } else {
      console.warn("Note that the return type of scanImage will change in the future. To already switch to the new api today, you can pass returnDetailedScanResult: true.");
    }
    const gotExternalEngine = !!qrEngine;
    try {
      let image;
      let canvasContext;
      [qrEngine, image] = await Promise.all([
        qrEngine || _QrScanner.createQrEngine(),
        _QrScanner._loadImage(imageOrFileOrBlobOrUrl)
      ]);
      [canvas, canvasContext] = _QrScanner._drawToCanvas(image, scanRegion, canvas, disallowCanvasResizing);
      let detailedScanResult;
      if (qrEngine instanceof Worker) {
        const qrEngineWorker = qrEngine;
        if (!gotExternalEngine) {
          qrEngineWorker.postMessage({type: "inversionMode", data: "both"});
        }
        detailedScanResult = await new Promise((resolve, reject) => {
          let timeout;
          let onMessage;
          let onError;
          onMessage = (event) => {
            if (event.data.type !== "qrResult") {
              return;
            }
            qrEngineWorker.removeEventListener("message", onMessage);
            qrEngineWorker.removeEventListener("error", onError);
            clearTimeout(timeout);
            if (event.data.data !== null) {
              resolve({
                data: event.data.data,
                cornerPoints: _QrScanner._convertPoints(event.data.cornerPoints, scanRegion)
              });
            } else {
              reject(_QrScanner.NO_QR_CODE_FOUND);
            }
          };
          onError = (error) => {
            qrEngineWorker.removeEventListener("message", onMessage);
            qrEngineWorker.removeEventListener("error", onError);
            clearTimeout(timeout);
            const errorMessage = !error ? "Unknown Error" : error.message || error;
            reject("Scanner error: " + errorMessage);
          };
          qrEngineWorker.addEventListener("message", onMessage);
          qrEngineWorker.addEventListener("error", onError);
          timeout = window.setTimeout(() => onError("timeout"), 1e4);
          const imageData = canvasContext.getImageData(0, 0, canvas.width, canvas.height);
          qrEngineWorker.postMessage({
            type: "decode",
            data: imageData
          }, [imageData.data.buffer]);
        });
      } else {
        detailedScanResult = await Promise.race([
          new Promise((resolve, reject) => window.setTimeout(() => reject("Scanner error: timeout"), 1e4)),
          (async () => {
            try {
              const [scanResult] = await qrEngine.detect(canvas);
              if (!scanResult)
                throw _QrScanner.NO_QR_CODE_FOUND;
              return {
                data: scanResult.rawValue,
                cornerPoints: _QrScanner._convertPoints(scanResult.cornerPoints, scanRegion)
              };
            } catch (e) {
              const errorMessage = e.message || e;
              if (/not implemented|service unavailable/.test(errorMessage)) {
                _QrScanner._disableBarcodeDetector = true;
                return _QrScanner.scanImage(imageOrFileOrBlobOrUrl, {
                  scanRegion,
                  canvas,
                  disallowCanvasResizing,
                  alsoTryWithoutScanRegion
                });
              }
              throw `Scanner error: ${errorMessage}`;
            }
          })()
        ]);
      }
      return returnDetailedScanResult ? detailedScanResult : detailedScanResult.data;
    } catch (e) {
      if (!scanRegion || !alsoTryWithoutScanRegion)
        throw e;
      const detailedScanResult = await _QrScanner.scanImage(imageOrFileOrBlobOrUrl, {qrEngine, canvas, disallowCanvasResizing});
      return returnDetailedScanResult ? detailedScanResult : detailedScanResult.data;
    } finally {
      if (!gotExternalEngine) {
        _QrScanner._postWorkerMessage(qrEngine, "close");
      }
    }
  }
  setGrayscaleWeights(red, green, blue, useIntegerApproximation = true) {
    _QrScanner._postWorkerMessage(this._qrEnginePromise, "grayscaleWeights", {red, green, blue, useIntegerApproximation});
  }
  setInversionMode(inversionMode) {
    _QrScanner._postWorkerMessage(this._qrEnginePromise, "inversionMode", inversionMode);
  }
  static async createQrEngine(workerPath) {
    if (workerPath) {
      console.warn("Specifying a worker path is not required and not supported anymore.");
    }
    const useNativeBarcodeDetector = !_QrScanner._disableBarcodeDetector && ("BarcodeDetector" in window && BarcodeDetector.getSupportedFormats ? (await BarcodeDetector.getSupportedFormats()).includes("qr_code") : false);
    return useNativeBarcodeDetector ? new BarcodeDetector({formats: ["qr_code"]}) : import("./worker.js").then((module) => module.default);
  }
  _onPlay() {
    this._scanRegion = this._calculateScanRegion(this.$video);
    this._updateOverlay();
    if (this.$overlay) {
      this.$overlay.style.display = "";
    }
    this._scanFrame();
  }
  _onLoadedMetaData() {
    this._scanRegion = this._calculateScanRegion(this.$video);
    this._updateOverlay();
  }
  _onVisibilityChange() {
    if (document.hidden) {
      this.pause();
    } else if (this._active) {
      this.start();
    }
  }
  _calculateScanRegion(video) {
    const smallestDimension = Math.min(video.videoWidth, video.videoHeight);
    const scanRegionSize = Math.round(2 / 3 * smallestDimension);
    return {
      x: Math.round((video.videoWidth - scanRegionSize) / 2),
      y: Math.round((video.videoHeight - scanRegionSize) / 2),
      width: scanRegionSize,
      height: scanRegionSize,
      downScaledWidth: this._legacyCanvasSize,
      downScaledHeight: this._legacyCanvasSize
    };
  }
  _updateOverlay() {
    requestAnimationFrame(() => {
      if (!this.$overlay)
        return;
      const video = this.$video;
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      const elementWidth = video.offsetWidth;
      const elementHeight = video.offsetHeight;
      const elementX = video.offsetLeft;
      const elementY = video.offsetTop;
      const videoStyle = window.getComputedStyle(video);
      const videoObjectFit = videoStyle.objectFit;
      const videoAspectRatio = videoWidth / videoHeight;
      const elementAspectRatio = elementWidth / elementHeight;
      let videoScaledWidth;
      let videoScaledHeight;
      switch (videoObjectFit) {
        case "none":
          videoScaledWidth = videoWidth;
          videoScaledHeight = videoHeight;
          break;
        case "fill":
          videoScaledWidth = elementWidth;
          videoScaledHeight = elementHeight;
          break;
        default:
          if (videoObjectFit === "cover" ? videoAspectRatio > elementAspectRatio : videoAspectRatio < elementAspectRatio) {
            videoScaledHeight = elementHeight;
            videoScaledWidth = videoScaledHeight * videoAspectRatio;
          } else {
            videoScaledWidth = elementWidth;
            videoScaledHeight = videoScaledWidth / videoAspectRatio;
          }
          if (videoObjectFit === "scale-down") {
            videoScaledWidth = Math.min(videoScaledWidth, videoWidth);
            videoScaledHeight = Math.min(videoScaledHeight, videoHeight);
          }
      }
      const [videoX, videoY] = videoStyle.objectPosition.split(" ").map((length, i) => {
        const lengthValue = parseFloat(length);
        return length.endsWith("%") ? (!i ? elementWidth - videoScaledWidth : elementHeight - videoScaledHeight) * lengthValue / 100 : lengthValue;
      });
      const regionWidth = this._scanRegion.width || videoWidth;
      const regionHeight = this._scanRegion.height || videoHeight;
      const regionX = this._scanRegion.x || 0;
      const regionY = this._scanRegion.y || 0;
      const overlayStyle = this.$overlay.style;
      overlayStyle.width = `${regionWidth / videoWidth * videoScaledWidth}px`;
      overlayStyle.height = `${regionHeight / videoHeight * videoScaledHeight}px`;
      overlayStyle.top = `${elementY + videoY + regionY / videoHeight * videoScaledHeight}px`;
      const isVideoMirrored = /scaleX\(-1\)/.test(video.style.transform);
      overlayStyle.left = `${elementX + (isVideoMirrored ? elementWidth - videoX - videoScaledWidth : videoX) + (isVideoMirrored ? videoWidth - regionX - regionWidth : regionX) / videoWidth * videoScaledWidth}px`;
      overlayStyle.transform = video.style.transform;
    });
  }
  static _convertPoints(points, scanRegion) {
    if (!scanRegion)
      return points;
    const offsetX = scanRegion.x || 0;
    const offsetY = scanRegion.y || 0;
    const scaleFactorX = scanRegion.width && scanRegion.downScaledWidth ? scanRegion.width / scanRegion.downScaledWidth : 1;
    const scaleFactorY = scanRegion.height && scanRegion.downScaledHeight ? scanRegion.height / scanRegion.downScaledHeight : 1;
    for (const point of points) {
      point.x = point.x * scaleFactorX + offsetX;
      point.y = point.y * scaleFactorY + offsetY;
    }
    return points;
  }
  _scanFrame() {
    if (!this._active || this.$video.paused || this.$video.ended)
      return;
    const requestFrame = "requestVideoFrameCallback" in this.$video ? this.$video.requestVideoFrameCallback.bind(this.$video) : requestAnimationFrame;
    requestFrame(async () => {
      if (this.$video.readyState <= 1) {
        this._scanFrame();
        return;
      }
      const timeSinceLastScan = Date.now() - this._lastScanTimestamp;
      const minimumTimeBetweenScans = 1e3 / this._maxScansPerSecond;
      if (timeSinceLastScan < minimumTimeBetweenScans) {
        await new Promise((resolve) => window.setTimeout(resolve, minimumTimeBetweenScans - timeSinceLastScan));
      }
      this._lastScanTimestamp = Date.now();
      let result;
      try {
        result = await _QrScanner.scanImage(this.$video, {
          scanRegion: this._scanRegion,
          qrEngine: this._qrEnginePromise,
          canvas: this.$canvas
        });
      } catch (error) {
        if (!this._active)
          return;
        this._onDecodeError(error);
      }
      if (_QrScanner._disableBarcodeDetector && !(await this._qrEnginePromise instanceof Worker)) {
        this._qrEnginePromise = _QrScanner.createQrEngine();
      }
      if (result) {
        if (this._onDecode) {
          this._onDecode(result);
        } else if (this._legacyOnDecode) {
          this._legacyOnDecode(result.data);
        }
        if (this.$codeOutlineHighlight) {
          clearTimeout(this._codeOutlineHighlightRemovalTimeout);
          this._codeOutlineHighlightRemovalTimeout = void 0;
          this.$codeOutlineHighlight.setAttribute("viewBox", `${this._scanRegion.x || 0} ${this._scanRegion.y || 0} ${this._scanRegion.width || this.$video.videoWidth} ${this._scanRegion.height || this.$video.videoHeight}`);
          const polygon = this.$codeOutlineHighlight.firstElementChild;
          polygon.setAttribute("points", result.cornerPoints.map(({x, y}) => `${x},${y}`).join(" "));
          this.$codeOutlineHighlight.style.display = "";
        }
      } else if (this.$codeOutlineHighlight && !this._codeOutlineHighlightRemovalTimeout) {
        this._codeOutlineHighlightRemovalTimeout = window.setTimeout(() => this.$codeOutlineHighlight.style.display = "none", 100);
      }
      this._scanFrame();
    });
  }
  _onDecodeError(error) {
    if (error === _QrScanner.NO_QR_CODE_FOUND)
      return;
    console.log(error);
  }
  async _getCameraStream() {
    if (!navigator.mediaDevices)
      throw "Camera not found.";
    const preferenceType = /^(environment|user)$/.test(this._preferredCamera) ? "facingMode" : "deviceId";
    const constraintsWithoutCamera = [{
      width: {min: 1024}
    }, {
      width: {min: 768}
    }, {}];
    const constraintsWithCamera = constraintsWithoutCamera.map((constraint) => Object.assign({}, constraint, {
      [preferenceType]: {exact: this._preferredCamera}
    }));
    for (const constraints of [...constraintsWithCamera, ...constraintsWithoutCamera]) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({video: constraints, audio: false});
        const facingMode = this._getFacingMode(stream) || (constraints.facingMode ? this._preferredCamera : this._preferredCamera === "environment" ? "user" : "environment");
        return {stream, facingMode};
      } catch (e) {
      }
    }
    throw "Camera not found.";
  }
  async _restartVideoStream() {
    const wasPaused = this._paused;
    const paused = await this.pause(true);
    if (!paused || wasPaused || !this._active)
      return;
    await this.start();
  }
  static _stopVideoStream(stream) {
    for (const track of stream.getTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
  }
  _setVideoMirror(facingMode) {
    const scaleFactor = facingMode === "user" ? -1 : 1;
    this.$video.style.transform = "scaleX(" + scaleFactor + ")";
  }
  _getFacingMode(videoStream) {
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack)
      return null;
    return /rear|back|environment/i.test(videoTrack.label) ? "environment" : /front|user|face/i.test(videoTrack.label) ? "user" : null;
  }
  static _drawToCanvas(image, scanRegion, canvas, disallowCanvasResizing = false) {
    canvas = canvas || document.createElement("canvas");
    const scanRegionX = scanRegion && scanRegion.x ? scanRegion.x : 0;
    const scanRegionY = scanRegion && scanRegion.y ? scanRegion.y : 0;
    const scanRegionWidth = scanRegion && scanRegion.width ? scanRegion.width : image.videoWidth || image.width;
    const scanRegionHeight = scanRegion && scanRegion.height ? scanRegion.height : image.videoHeight || image.height;
    if (!disallowCanvasResizing) {
      const canvasWidth = scanRegion && scanRegion.downScaledWidth ? scanRegion.downScaledWidth : scanRegionWidth;
      const canvasHeight = scanRegion && scanRegion.downScaledHeight ? scanRegion.downScaledHeight : scanRegionHeight;
      if (canvas.width !== canvasWidth) {
        canvas.width = canvasWidth;
      }
      if (canvas.height !== canvasHeight) {
        canvas.height = canvasHeight;
      }
    }
    const context = canvas.getContext("2d", {alpha: false});
    context.imageSmoothingEnabled = false;
    context.drawImage(image, scanRegionX, scanRegionY, scanRegionWidth, scanRegionHeight, 0, 0, canvas.width, canvas.height);
    return [canvas, context];
  }
  static async _loadImage(imageOrFileOrBlobOrUrl) {
    if (imageOrFileOrBlobOrUrl instanceof Image) {
      await _QrScanner._awaitImageLoad(imageOrFileOrBlobOrUrl);
      return imageOrFileOrBlobOrUrl;
    } else if (imageOrFileOrBlobOrUrl instanceof HTMLVideoElement || imageOrFileOrBlobOrUrl instanceof HTMLCanvasElement || imageOrFileOrBlobOrUrl instanceof SVGImageElement || "OffscreenCanvas" in window && imageOrFileOrBlobOrUrl instanceof OffscreenCanvas || "ImageBitmap" in window && imageOrFileOrBlobOrUrl instanceof ImageBitmap) {
      return imageOrFileOrBlobOrUrl;
    } else if (imageOrFileOrBlobOrUrl instanceof File || imageOrFileOrBlobOrUrl instanceof Blob || imageOrFileOrBlobOrUrl instanceof URL || typeof imageOrFileOrBlobOrUrl === "string") {
      const image = new Image();
      if (imageOrFileOrBlobOrUrl instanceof File || imageOrFileOrBlobOrUrl instanceof Blob) {
        image.src = URL.createObjectURL(imageOrFileOrBlobOrUrl);
      } else {
        image.src = imageOrFileOrBlobOrUrl.toString();
      }
      try {
        await _QrScanner._awaitImageLoad(image);
        return image;
      } finally {
        if (imageOrFileOrBlobOrUrl instanceof File || imageOrFileOrBlobOrUrl instanceof Blob) {
          URL.revokeObjectURL(image.src);
        }
      }
    } else {
      throw "Unsupported image type.";
    }
  }
  static async _awaitImageLoad(image) {
    if (image.complete && image.naturalWidth !== 0)
      return;
    await new Promise((resolve, reject) => {
      const listener = (event) => {
        image.removeEventListener("load", listener);
        image.removeEventListener("error", listener);
        if (event instanceof ErrorEvent) {
          reject("Image load error");
        } else {
          resolve();
        }
      };
      image.addEventListener("load", listener);
      image.addEventListener("error", listener);
    });
  }
  static async _postWorkerMessage(qrEngineOrQrEnginePromise, type, data) {
    const qrEngine = await qrEngineOrQrEnginePromise;
    if (!(qrEngine instanceof Worker))
      return;
    qrEngine.postMessage({type, data});
  }
};
let QrScanner = _QrScanner;
QrScanner.DEFAULT_CANVAS_SIZE = 400;
QrScanner.NO_QR_CODE_FOUND = "No QR code found";
QrScanner._disableBarcodeDetector = false;
export default QrScanner;
