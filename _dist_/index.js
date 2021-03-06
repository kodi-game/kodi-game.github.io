import QrScanner from "./qr-scanner.js";
console.log("-------------------------------------");
console.log(`${document.title}`);
console.log("-------------------------------------");
async function onClient() {
  const videoPreview = document.getElementById("videoPreview");
  if (videoPreview !== null) {
    const displayArea = document.getElementById("displayArea");
    if (displayArea) {
      displayArea.style.display = "none";
    }
    videoPreview.style.display = "block";
    const qrScanner = new QrScanner(videoPreview, (result) => {
      qrScanner.stop();
      videoPreview.style.display = "none";
      if (displayArea) {
        displayArea.style.display = "block";
      }
      alert(`Decoded QR code: ${result.data}`);
    }, {});
    await qrScanner.start();
  }
}
const contentArea = document.getElementById("contentArea");
if (contentArea !== null) {
  contentArea.onclick = onClient;
}
window.addEventListener("load", async () => {
  console.log("Entering application");
});
export {};
