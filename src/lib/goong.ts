import { z } from "zod";
import { fail } from "./errors";
import type { ShippingPoint } from "./shipping-types";

export const goongConfigured = () => !!process.env.GOONG_API_KEY?.trim();
// Live V2 rejects `motorcycle` despite the help page listing it. Keep our
// business value stable and translate only at the provider boundary.
export const GOONG_ROUTING_REVISION = "goong-v2-bike-1";
export const goongRouteProfile = (vehicle: "motorcycle" | "car") =>
  vehicle === "motorcycle" ? ("bike" as const) : ("car" as const);

function providerStatusError(status: unknown) {
  if (status === "REQUEST_DENIED" || status === "PERMISSION_DENIED")
    fail(
      "GOONG_ACCESS_DENIED",
      "Dịch vụ địa chỉ chưa được cấp quyền truy cập. Vui lòng liên hệ cửa hàng kiểm tra cấu hình Goong.",
      503,
    );
  if (status === "OVER_QUERY_LIMIT" || status === "OVER_DAILY_LIMIT")
    fail(
      "GOONG_RATE_LIMITED",
      "Dịch vụ địa chỉ đã đạt giới hạn lượt gọi. Vui lòng thử lại sau hoặc liên hệ cửa hàng.",
      503,
    );
  if (status === "INVALID_REQUEST")
    fail(
      "GOONG_INVALID_REQUEST",
      "Yêu cầu tới dịch vụ địa chỉ chưa hợp lệ. Vui lòng liên hệ cửa hàng kiểm tra cấu hình Goong.",
      502,
    );
}
async function call(path: string, params: Record<string, string>) {
  const key = process.env.GOONG_API_KEY?.trim();
  if (!key)
    fail(
      "GOONG_NOT_CONFIGURED",
      "Cửa hàng chưa cấu hình dịch vụ địa chỉ Goong.",
      503,
    );
  let response: Response;
  try {
    response = await fetch(
      `https://rsapi.goong.io/v2/${path}?${new URLSearchParams({ ...params, api_key: key })}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
        redirect: "error",
      },
    );
  } catch {
    fail(
      "GOONG_UNAVAILABLE",
      "Chưa kết nối được dịch vụ địa chỉ. Vui lòng thử lại.",
      503,
    );
  }
  if (!response.ok) {
    // Never forward upstream bodies/URLs: they may echo credentials or addresses.
    if ([400, 422].includes(response.status))
      providerStatusError("INVALID_REQUEST");
    if ([401, 403].includes(response.status))
      providerStatusError("REQUEST_DENIED");
    if (response.status === 429) providerStatusError("OVER_QUERY_LIMIT");
    fail(
      "GOONG_UNAVAILABLE",
      "Dịch vụ địa chỉ chưa sẵn sàng. Vui lòng thử lại hoặc liên hệ cửa hàng.",
      503,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    fail(
      "GOONG_INVALID_RESPONSE",
      "Dịch vụ địa chỉ trả về dữ liệu không hợp lệ.",
      502,
    );
  }
  if (data && typeof data === "object" && "status" in data)
    providerStatusError(data.status);
  return data;
}
export async function goongAutocomplete(
  query: string,
  origin: ShippingPoint | null,
) {
  const data = await call("place/autocomplete", {
    input: query,
    limit: "5",
    has_deprecated_administrative_unit: "true",
    ...(origin ? { location: `${origin.lat},${origin.lng}` } : {}),
  });
  const parsed = z
    .object({
      status: z.string(),
      predictions: z.array(
        z.object({
          place_id: z.string().max(2048),
          description: z.string().max(500),
          structured_formatting: z
            .object({ main_text: z.string(), secondary_text: z.string() })
            .optional(),
        }),
      ),
    })
    .safeParse(data);
  if (!parsed.success || !["OK", "ZERO_RESULTS"].includes(parsed.data.status))
    fail("GOONG_UNAVAILABLE", "Chưa tìm được địa chỉ. Vui lòng thử lại.", 503);
  return parsed.data.predictions.slice(0, 5).map((p) => ({
    placeId: p.place_id,
    address: p.description,
    main: p.structured_formatting?.main_text ?? p.description,
    secondary: p.structured_formatting?.secondary_text ?? "",
  }));
}
export async function goongDetail(placeId: string): Promise<ShippingPoint> {
  const data = await call("place/detail", {
    place_id: placeId,
    has_deprecated_administrative_unit: "true",
  });
  const parsed = z
    .object({
      status: z.literal("OK"),
      result: z.object({
        place_id: z.string().max(2048),
        name: z.string().optional(),
        formatted_address: z.string().min(1).max(500),
        geometry: z.object({
          location: z.object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
          }),
        }),
      }),
    })
    .safeParse(data);
  if (!parsed.success)
    fail(
      "ADDRESS_NOT_FOUND",
      "Chưa xác định được địa điểm. Hãy chọn lại địa chỉ cụ thể.",
      422,
    );
  const p = parsed.data.result;
  const address =
    p.name &&
    !p.formatted_address
      .toLocaleLowerCase("vi")
      .startsWith(p.name.toLocaleLowerCase("vi"))
      ? `${p.name}, ${p.formatted_address}`
      : p.formatted_address;
  return {
    placeId: p.place_id,
    address: address.slice(0, 500),
    ...p.geometry.location,
  };
}
export async function goongDistance(
  origin: ShippingPoint,
  destination: ShippingPoint,
  vehicle: "motorcycle" | "car",
) {
  const data = await call("distancematrix", {
    origins: `${origin.lat},${origin.lng}`,
    destinations: `${destination.lat},${destination.lng}`,
    vehicle: goongRouteProfile(vehicle),
  });
  const parsed = z
    .object({
      rows: z.array(
        z.object({
          elements: z.array(
            z.object({
              status: z.string(),
              distance: z
                .object({ value: z.number().int().min(0).max(10000000) })
                .optional(),
              duration: z
                .object({ value: z.number().int().min(0).max(10000000) })
                .optional(),
            }),
          ),
        }),
      ),
    })
    .safeParse(data);
  const element = parsed.success ? parsed.data.rows[0]?.elements[0] : undefined;
  if (
    !element ||
    element.status !== "OK" ||
    !element.distance ||
    !element.duration
  )
    fail(
      "NO_DELIVERY_ROUTE",
      "Không tìm được tuyến giao phù hợp. Hãy chọn lại địa chỉ hoặc liên hệ cửa hàng.",
      422,
    );
  return {
    distanceMeters: element.distance.value,
    durationSeconds: element.duration.value,
  };
}
