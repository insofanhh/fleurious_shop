"use client";
import { useEffect, useState } from "react";
import { request, useShop } from "./shop-provider";
import { AddressAutocomplete } from "./ui/address-autocomplete";
import { Select } from "./ui/select";
import { ShippingSummary } from "./shipping-summary";
import { useShippingQuote } from "./use-shipping-quote";
import type { AddressSelection, ShippingPoint } from "@/lib/shipping-types";
type Data = {
  mode: "DISTANCE";
  version: number;
  origin: ShippingPoint | null;
  configured: boolean;
  displayAddress: string;
  ratePerKm: number | null;
  vehicle: "motorcycle" | "car";
  maxDistanceMeters: number | null;
  roundingStep: 1 | 1000;
  minimumFee: number;
  maximumFee: number | null;
  allowManual: boolean;
};
export function ShippingSettings({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const { toast } = useShop();
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [address, setAddress] = useState(""),
    [point, setPoint] = useState<AddressSelection | null>(null),
    [rate, setRate] = useState(""),
    [vehicle, setVehicle] = useState("motorcycle"),
    [maxKm, setMaxKm] = useState(""),
    [step, setStep] = useState("1"),
    [minimum, setMinimum] = useState("0"),
    [maximum, setMaximum] = useState(""),
    [manual, setManual] = useState(true);
  const [testAddress, setTestAddress] = useState(""),
    [testPoint, setTestPoint] = useState<AddressSelection | null>(null);
  const preview = useShippingQuote(
    testPoint?.id,
    data?.mode === "DISTANCE",
    data?.version ?? 0,
  );
  async function load() {
    const result = await request<Data>("admin/settings/delivery");
    setData(result);
    setAddress(result.origin?.address ?? result.displayAddress);
    setPoint(result.origin ? { ...result.origin, id: "" } : null);
    setRate(result.ratePerKm === null ? "" : String(result.ratePerKm));
    setVehicle(result.vehicle);
    setMaxKm(
      result.maxDistanceMeters === null
        ? ""
        : String(result.maxDistanceMeters / 1000),
    );
    setStep(String(result.roundingStep));
    setMinimum(String(result.minimumFee));
    setMaximum(result.maximumFee == null ? "" : String(result.maximumFee));
    setManual(result.allowManual);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="shipping-settings">
      <h2>Giao hoa theo quãng đường.</h2>
      <p className="shipping-settings-status">
        {data?.configured
          ? "Goong REST API đã có key trong môi trường server."
          : "Chưa có GOONG_API_KEY. Thêm key vào ENV local/production để bật gợi ý và tính quãng đường."}{" "}
        Biểu phí mới áp dụng cho đơn mới; đơn đã tạo giữ nguyên số tiền.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <button
          className="button secondary"
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Tải cấu hình giao hàng
        </button>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await request(
                "admin/settings/delivery",
                {
                  version: data.version,
                  mode: "DISTANCE",
                  originLocationId: point?.id || undefined,
                  displayAddress: address,
                  ratePerKm: rate === "" ? null : Number(rate),
                  vehicle,
                  maxDistanceMeters:
                    maxKm === "" ? null : Math.round(Number(maxKm) * 1000),
                  roundingStep: Number(step),
                  minimumFee: Number(minimum),
                  maximumFee: maximum === "" ? null : Number(maximum),
                  allowManual: manual,
                },
                "PATCH",
              );
              await load();
              await onSaved();
              toast("Đã lưu chính sách giao hàng.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <AddressAutocomplete
            label="Địa chỉ cửa hàng / điểm xuất phát"
            value={address}
            onChange={setAddress}
            selection={point}
            onSelect={setPoint}
            enabled={data.configured}
            requireSelection={data.configured}
          />
          <div className="two-columns">
            <label>
              Phương tiện
              <Select
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
              >
                <option value="motorcycle">Xe máy</option>
                <option value="car">Ô tô</option>
              </Select>
            </label>
          </div>
          <p className="small muted">
            Tuyến hai bánh sử dụng profile “bike” của Goong; ô tô sử dụng “car”.
          </p>
          <div className="two-columns">
            <label>
              Giá ship/km (VNĐ)
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                required
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <label>
              Giới hạn quãng đường (km, để trống nếu không giới hạn)
              <input
                type="number"
                min="0.001"
                max="3000"
                step="0.001"
                value={maxKm}
                onChange={(e) => setMaxKm(e.target.value)}
              />
            </label>
          </div>
          <label>
            Làm tròn tiền
            <Select value={step} onChange={(e) => setStep(e.target.value)}>
              <option value="1">Làm tròn đến 1đ</option>
              <option value="1000">Làm tròn lên mỗi 1.000đ</option>
            </Select>
          </label>
          <div className="two-columns">
            <label>
              Phí tối thiểu (0 = tắt)
              <input
                type="number"
                min="0"
                max="100000000"
                step="1"
                required
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
              />
            </label>
            <label>
              Phí tối đa (VNĐ, để trống nếu không giới hạn)
              <input
                type="number"
                min={Number(minimum) || 0}
                max="100000000"
                step="1"
                value={maximum}
                onChange={(e) => setMaximum(e.target.value)}
                placeholder="Không giới hạn"
              />
            </label>
          </div>
          <p className="small muted">
            Phí tự động không vượt mức tối đa sau khi làm tròn. Phí theo thỏa
            thuận được nhập riêng.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={manual}
              onChange={(e) => setManual(e.target.checked)}
            />
            Cho Owner/Manager nhập phí thỏa thuận trong đơn thủ công, có lý do
            và nhật ký
          </label>
          <button className="button glass-primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu cấu hình giao hàng"}
          </button>
        </form>
      )}
      {data?.mode === "DISTANCE" && (
        <div style={{ marginTop: 24 }}>
          <h3>Thử phí theo cấu hình đã lưu.</h3>
          <AddressAutocomplete
            label="Địa chỉ nhận thử"
            value={testAddress}
            onChange={setTestAddress}
            selection={testPoint}
            onSelect={setTestPoint}
            enabled={data.configured}
            required={false}
          />
          <ShippingSummary
            quote={preview.quote}
            checking={preview.checking}
            error={preview.error}
            onRetry={preview.refresh}
          />
        </div>
      )}
    </section>
  );
}
