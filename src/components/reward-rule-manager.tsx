"use client";
import { Select } from "./ui/select";
import { useState } from "react";
import { Plus, Check } from "lucide-react";
import type { RewardRule } from "@/lib/reward-rules";
import { money } from "@/lib/time";
import { request, useShop } from "./shop-provider";
type NumericField = "threshold" | "percent" | "cap" | "minimum" | "validDays";
type RewardDraft = Omit<RewardRule, NumericField> &
  Record<NumericField, number | "">;
export function RewardRuleManager({
  rules,
  version,
  onSaved,
}: {
  rules: RewardRule[];
  version: number;
  onSaved: () => Promise<void>;
}) {
  const { products, toast, refreshCatalog } = useShop();
  const [draft, setDraft] = useState<RewardDraft | null>(null),
    [busy, setBusy] = useState(false);
  function create() {
    setDraft({
      id: "",
      name: "Một món quà cho ngày có hoa",
      kind: "monthly",
      threshold: 10,
      percent: 5,
      cap: 50000,
      minimum: 300000,
      validDays: 30,
      productId: null,
      active: true,
      startsOn: null,
      endsOn: null,
    });
  }
  return (
    <section className="admin-panel" style={{ marginTop: 30 }}>
      <div className="panel-heading">
        <h2>Các mốc thưởng tùy chỉnh</h2>
        <button className="text-link" onClick={create}>
          <Plus size={15} />
          Thêm mốc
        </button>
      </div>
      <p className="small muted">
        Hai mốc cơ bản được chỉnh trong Cài đặt. Có thể bổ sung tối đa 20 mốc ở
        đây; mỗi mốc cấp một lần/user/tháng khi chạm ngưỡng. Thay đổi không cấp
        bù ngày đã qua.
      </p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mốc</th>
              <th>Điều kiện</th>
              <th>Ưu đãi</th>
              <th>Phạm vi</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>
                  {r.threshold} ngày{" "}
                  {r.kind === "monthly" ? "trong tháng" : "liên tiếp"}
                </td>
                <td>
                  {r.percent}% · tối đa {money(r.cap)}
                </td>
                <td>
                  {r.productId
                    ? (products.find((p) => p.id === r.productId)?.name ??
                      "Sản phẩm đã ẩn")
                    : "Tổng tiền hoa"}
                </td>
                <td>{r.active ? "Đang bật" : "Tạm ngừng"}</td>
                <td>
                  <div className="table-actions">
                    <button onClick={() => setDraft(r)}>Sửa</button>
                    <button
                      onClick={async () => {
                        try {
                          await request(
                            `admin/streaks/rules/${r.id}`,
                            { version },
                            "DELETE",
                          );
                          await onSaved();
                          await refreshCatalog();
                          toast("Đã tạm ngừng mốc; giữ quyền lợi đã cấp.");
                        } catch (e) {
                          toast((e as Error).message);
                        }
                      }}
                    >
                      Tạm ngừng
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={6}>Chưa có mốc bổ sung.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {draft && (
        <form
          className="form-stack"
          style={{ marginTop: 25 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (
                [
                  draft.threshold,
                  draft.percent,
                  draft.cap,
                  draft.minimum,
                  draft.validDays,
                ].some((value) => value === "")
              )
                throw new Error(
                  "Vui lòng nhập đầy đủ các giá trị số trước khi công bố.",
                );
              const rule = {
                ...draft,
                threshold: Number(draft.threshold),
                percent: Number(draft.percent),
                cap: Number(draft.cap),
                minimum: Number(draft.minimum),
                validDays: Number(draft.validDays),
              };
              await request(
                `admin/streaks/rules${draft.id ? `/${draft.id}` : ""}`,
                { version, rule },
                draft.id ? "PATCH" : "POST",
              );
              setDraft(null);
              await onSaved();
              await refreshCatalog();
              toast("Đã công bố mốc thưởng.");
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{draft.id ? "Chỉnh mốc thưởng" : "Một mốc mới cho lịch hoa"}</h3>
          <div className="two-columns">
            <label>
              Tên mốc
              <input
                value={draft.name}
                required
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Cách đếm
              <Select
                value={draft.kind}
                disabled={!!draft.id}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as RewardRule["kind"],
                  })
                }
              >
                <option value="monthly">Tích lũy tháng</option>
                <option value="consecutive">Liên tiếp</option>
              </Select>
            </label>
            {[
              {
                key: "threshold",
                label: "Số ngày",
                max: draft.kind === "monthly" ? 31 : 366,
              },
              { key: "percent", label: "Giảm %", max: 50 },
              { key: "cap", label: "Trần giảm VND", max: 1000000 },
              {
                key: "minimum",
                label: "Tiền hoa đủ điều kiện từ VND",
                max: 10000000,
              },
              { key: "validDays", label: "Hiệu lực ưu đãi (ngày)", max: 365 },
            ].map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type="number"
                  min={f.key === "minimum" ? 0 : 1}
                  max={f.max}
                  required
                  value={draft[f.key as NumericField]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [f.key]:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
            <label>
              Giảm trên
              <Select
                value={draft.productId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, productId: e.target.value || null })
                }
              >
                <option value="">Tổng tiền hoa (không gồm ship)</option>
                {draft.productId &&
                  !products.some((p) => p.id === draft.productId) && (
                    <option value={draft.productId}>
                      Sản phẩm đã ẩn · giữ phạm vi cũ
                    </option>
                  )}
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · các size
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Bắt đầu, giờ Hà Nội
              <input
                type="date"
                value={draft.startsOn ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, startsOn: e.target.value || null })
                }
              />
            </label>
            <label>
              Kết thúc (bao gồm ngày này)
              <input
                type="date"
                value={draft.endsOn ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, endsOn: e.target.value || null })
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked })
                }
              />
              Bật mốc
            </label>
          </div>
          <div className="notice">
            Xem trước: {draft.threshold} ngày{" "}
            {draft.kind === "monthly" ? "trong tháng" : "liên tiếp"} → giảm{" "}
            {draft.percent}%, tối đa {draft.cap === "" ? "—" : money(draft.cap)}
            , trên{" "}
            {draft.productId
              ? (products.find((p) => p.id === draft.productId)?.name ??
                "sản phẩm đã chọn")
              : "tiền hoa của đơn"}
            ; phần áp dụng từ{" "}
            {draft.minimum === "" ? "—" : money(draft.minimum)}. Dùng trong{" "}
            {draft.validDays} ngày, một ưu đãi tiền hàng/đơn.
          </div>
          <div style={{ display: "flex", gap: 15 }}>
            <button className="button" disabled={busy}>
              <Check size={16} />
              {busy ? "Đang lưu…" : "Công bố mốc"}
            </button>
            <button
              className="text-link"
              type="button"
              onClick={() => setDraft(null)}
            >
              Đóng
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
