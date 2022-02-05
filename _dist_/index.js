import QrScanner from "./qr-scanner.js";
console.log("-------------------------------------");
console.log(`${document.title}`);
console.log("-------------------------------------");
function onClient() {
  const videoPreview = document.getElementById("videoPreview");
  if (videoPreview !== null) {
    const kodiLogo = document.getElementById("kodiLogo");
    if (kodiLogo) {
      kodiLogo.style.display = "none";
    }
    videoPreview.style.display = "block";
    const qrScanner = new QrScanner(videoPreview, (result) => console.log("decoded qr code:", result), {});
    qrScanner.start();
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
