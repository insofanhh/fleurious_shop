/** Only canonical paths on this site may survive a sign-in redirect. */
export function safeAuthNext(value?: string | null) {
  if (
    !value ||
    value.length > 1000 ||
    !value.startsWith("/") ||
    /[\\\x00-\x20]/.test(value)
  )
    return "/account";
  try {
    const url = new URL(value, "https://fleurious.invalid");
    if (
      url.origin !== "https://fleurious.invalid" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/")
    )
      return "/account";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/account";
  }
}

export const googleAuthErrors: Record<string, string> = {
  unavailable:
    "Đăng nhập Google chưa sẵn sàng. Bạn có thể dùng email và mật khẩu.",
  cancelled: "Bạn đã hủy đăng nhập Google. Có thể thử lại hoặc dùng mật khẩu.",
  expired:
    "Phiên đăng nhập Google đã hết hạn hoặc đã được dùng. Vui lòng thử lại.",
  account_exists:
    "Email này đã có tài khoản. Hãy đăng nhập bằng mật khẩu, rồi liên kết Google trong Hồ sơ.",
  blocked: "Tài khoản chưa thể đăng nhập. Vui lòng liên hệ cửa hàng.",
  link_mismatch:
    "Hãy chọn tài khoản Google có cùng email với tài khoản Fleurious đang đăng nhập.",
  failed: "Chưa thể xác minh đăng nhập Google. Vui lòng thử lại.",
};
