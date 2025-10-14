export function showToast(message, type = "success") {
  const backgroundColor =
    type === "success"
      ? "linear-gradient(to right, #4CAF50, #77dd77)"
      : "linear-gradient(to right, #f06595, #ff6b6b)";
  const safeMessage = String(message ?? "");
  Toastify({
    text: safeMessage,
    duration: 3000,
    close: true,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: { background: backgroundColor },
    className: `toastify-${type}`
  }).showToast();
}
