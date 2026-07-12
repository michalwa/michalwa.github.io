export function sendGiscusMessage(message) {
  const giscus = document.querySelector("iframe.giscus-frame");
  giscus?.contentWindow.postMessage({ giscus: message }, "https://giscus.app");
}
