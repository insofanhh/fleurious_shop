"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>Chúng mình cần một chút thời gian.</h1>
      <p>Chưa thể tải nội dung. Vui lòng thử lại.</p>
      <button className="button" onClick={reset}>
        Thử lại
      </button>
    </div>
  );
}
