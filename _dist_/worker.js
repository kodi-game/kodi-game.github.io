import jsQR from "../_snowpack/pkg/jsqr.js";
let inversionAttempts = "dontInvert";
let grayscaleWeights = {
  red: 77,
  green: 150,
  blue: 29,
  useIntegerApproximation: true
};
self.onmessage = (event) => {
  const type = event["data"]["type"];
  const data = event["data"]["data"];
  switch (type) {
    case "decode":
      decode(data);
      break;
    case "grayscaleWeights":
      setGrayscaleWeights(data);
      break;
    case "inversionMode":
      setInversionMode(data);
      break;
    case "close":
      self.close();
      break;
  }
};
function decode(data) {
  const rgbaData = data["data"];
  const width = data["width"];
  const height = data["height"];
  const result = jsQR(rgbaData, width, height, {
    inversionAttempts,
    greyScaleWeights: grayscaleWeights
  });
  if (!result) {
    self.postMessage({
      type: "qrResult",
      data: null
    });
    return;
  }
  self.postMessage({
    type: "qrResult",
    data: result.data,
    cornerPoints: [
      result.location.topLeftCorner,
      result.location.topRightCorner,
      result.location.bottomRightCorner,
      result.location.bottomLeftCorner
    ]
  });
}
function setGrayscaleWeights(data) {
  grayscaleWeights.red = data["red"];
  grayscaleWeights.green = data["green"];
  grayscaleWeights.blue = data["blue"];
  grayscaleWeights.useIntegerApproximation = data["useIntegerApproximation"];
}
function setInversionMode(inversionMode) {
  switch (inversionMode) {
    case "original":
      inversionAttempts = "dontInvert";
      break;
    case "invert":
      inversionAttempts = "onlyInvert";
      break;
    case "both":
      inversionAttempts = "attemptBoth";
      break;
    default:
      throw new Error("Invalid inversion mode");
  }
}
