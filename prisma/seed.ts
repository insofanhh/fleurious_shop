import "dotenv/config";
import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { db } from "../src/lib/db";
import { defaultSettings } from "../src/lib/settings";
const products = [
  {
    slug: "burgundy-whisper",
    name: "Burgundy Whisper",
    subtitle: "Một lời yêu, không cần thành tiếng.",
    category: "Bó hoa",
    occasion: "Kỷ niệm",
    color: "Đỏ",
    image: "/images/roses.webp",
    badge: "Được yêu thích",
    price: 650000,
    featured: true,
  },
  {
    slug: "morning-in-hanoi",
    name: "Morning in Hanoi",
    subtitle: "Dành một chút dịu dàng cho ngày mới.",
    category: "Bình hoa",
    occasion: "Tặng bản thân",
    color: "Trắng",
    image: "/images/white.webp",
    badge: "Hoa theo mùa",
    price: 480000,
    featured: true,
  },
  {
    slug: "petal-poetry",
    name: "Petal Poetry",
    subtitle: "Những cánh hoa kể chuyện thay bạn.",
    category: "Bó hoa",
    occasion: "Sinh nhật",
    color: "Hồng",
    image: "/images/pink.webp",
    badge: "",
    price: 550000,
    featured: true,
  },
  {
    slug: "sun-kissed",
    name: "Sun Kissed",
    subtitle: "Mang một khoảng nắng tới người thương.",
    category: "Bó hoa",
    occasion: "Chúc mừng",
    color: "Vàng",
    image: "/images/yellow.webp",
    badge: "",
    price: 420000,
    featured: true,
  },
  {
    slug: "soft-sunday",
    name: "Soft Sunday",
    subtitle: "Chậm lại, và ngắm một đóa hoa.",
    category: "Giỏ hoa",
    occasion: "Tặng bản thân",
    color: "Hồng",
    image: "/images/soft.webp",
    badge: "Mới",
    price: 720000,
    featured: false,
  },
  {
    slug: "a-little-love",
    name: "A Little Love",
    subtitle: "Niềm vui nhỏ, dành riêng cho bạn.",
    category: "Bó hoa",
    occasion: "Sinh nhật",
    color: "Tím",
    image: "/images/lilac.webp",
    badge: "",
    price: 350000,
    featured: true,
  },
  {
    slug: "garden-letter",
    name: "Garden Letter",
    subtitle: "Một lá thư từ khu vườn mùa thu.",
    category: "Bình hoa",
    occasion: "Kỷ niệm",
    color: "Trắng",
    image: "/images/garden.webp",
    badge: "",
    price: 890000,
    featured: false,
  },
  {
    slug: "blooming-wishes",
    name: "Blooming Wishes",
    subtitle: "Cho một khởi đầu thật rực rỡ.",
    category: "Giỏ hoa",
    occasion: "Chúc mừng",
    color: "Hồng",
    image: "/images/wishes.webp",
    badge: "",
    price: 1150000,
    featured: false,
  },
];
async function main() {
  await db.setting.upsert({
    where: { key: "shop" },
    update: {},
    create: { key: "shop", value: defaultSettings },
  });
  await db.setting.upsert({
    where: { key: "reward_budget" },
    update: {},
    create: { key: "reward_budget", value: { committed: 0 } },
  });
  for (const [index, p] of products.entries()) {
    const { price, ...data } = p;
    await db.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        ...data,
        description: `${p.subtitle}\nĐược florist lựa chọn và bó thủ công từ những cành hoa tươi theo mùa. Mỗi bó hoa có một nét riêng; màu sắc thực tế có thể thay đổi nhẹ theo mùa. Chúng tôi sẽ liên hệ trước nếu cần thay loại hoa.\nKèm thiệp viết tay và hướng dẫn chăm hoa. Thay nước sạch mỗi ngày, cắt vát gốc và đặt nơi thoáng mát, tránh nắng trực tiếp.`,
        images: [p.image],
        sortOrder: index,
        variants: {
          create: [
            { name: "Vừa xinh", sku: `FL-${index}-M`, price, stock: 30 },
            {
              name: "Đong đầy",
              sku: `FL-${index}-L`,
              price: price + 200000,
              stock: 20,
            },
          ],
        },
      },
    });
  }
  for (const [id, name, fee] of [
    ["zone-center", "Ba Đình · Hoàn Kiếm · Đống Đa", 30000],
    ["zone-west", "Cầu Giấy · Tây Hồ · Thanh Xuân", 40000],
    ["zone-east", "Long Biên · Hai Bà Trưng · Hoàng Mai", 50000],
  ] as const)
    await db.deliveryZone.upsert({
      where: { id },
      update: {},
      create: { id, name, fee },
    });
  for (const [id, label, startHour, endHour] of [
    ["slot-am", "09:00 – 12:00", 9, 12],
    ["slot-noon", "12:00 – 15:00", 12, 15],
    ["slot-pm", "15:00 – 18:00", 15, 18],
    ["slot-evening", "18:00 – 21:00", 18, 21],
  ] as const)
    await db.deliverySlot.upsert({
      where: { id },
      update: {},
      create: { id, label, startHour, endHour, capacity: 12 },
    });
  for (const [kind, names] of Object.entries({
    CATEGORY: ["Bó hoa", "Bình hoa", "Giỏ hoa"],
    OCCASION: ["Sinh nhật", "Kỷ niệm", "Chúc mừng", "Tặng bản thân"],
    COLOR: ["Đỏ", "Trắng", "Hồng", "Tím", "Vàng"],
    SIZE: ["Vừa xinh", "Đong đầy"],
  })) {
    for (const name of names) {
      if (await db.taxonomy.findFirst({ where: { kind, name } })) continue;
      const slug = name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replaceAll("đ", "d")
        .replace(/\s+/g, "-");
      await db.taxonomy.upsert({
        where: { slug },
        update: {},
        create: { kind, name, slug, description: "", productIds: [] },
      });
    }
  }
  const content = [
    {
      kind: "page",
      slug: "about",
      title: "Những điều dịu dàng, bắt đầu từ hoa",
      body: "Fleurious là một góc nhỏ dành cho những người tin rằng hoa có thể nói thay những điều khó ngỏ.\nTừ Hà Nội, chúng tôi lựa từng cành hoa theo mùa, bó thủ công và gửi đi cùng sự chỉn chu. Một bó hoa để yêu thương, để cảm ơn, hoặc đơn giản để ngày hôm nay đẹp hơn.",
    },
    {
      kind: "page",
      slug: "delivery",
      title: "Giao hoa tại Hà Nội",
      body: "Chọn khu vực, ngày và khung giờ giao ngay khi đặt hàng. Phí giao được hiển thị trước thanh toán.\nVui lòng đặt trước ít nhất 2 giờ. Khung giờ có giới hạn số đơn để chúng tôi chuẩn bị hoa chỉn chu. Cửa hàng sẽ liên hệ nếu cần điều chỉnh.\nCác dịp cao điểm có thể áp dụng thời gian chuẩn bị riêng.",
    },
    {
      kind: "page",
      slug: "returns",
      title: "Chăm chút đến khi hoa tới nơi",
      body: "Nếu hoa gặp vấn đề khi nhận, vui lòng liên hệ cửa hàng cùng hình ảnh thực tế và mã đơn. Chúng tôi sẽ kiểm tra và trao đổi phương án đổi hoa hoặc hoàn tiền phù hợp.\nYêu cầu hủy đơn cần được cửa hàng xác nhận trước khi hoa sẵn giao. Khoản chuyển khoản được hoàn bằng giao dịch đối soát riêng.",
    },
    {
      kind: "page",
      slug: "privacy",
      title: "Quyền riêng tư của bạn",
      body: "Thông tin liên hệ và địa chỉ chỉ được sử dụng để xử lý đơn và hỗ trợ khách hàng. Lời nhắn trên thiệp và lịch ảnh giữ chuỗi không được công khai.\nBạn có thể liên hệ cửa hàng để yêu cầu chỉnh sửa hoặc xử lý dữ liệu tài khoản. Thông báo marketing chỉ được gửi khi bạn đồng ý.",
    },
    {
      kind: "article",
      slug: "cham-hoa",
      title: "Để những ngày có hoa dài hơn",
      body: "Cắt vát gốc 1–2 cm bằng kéo sạch.\nThay nước mỗi ngày và rửa bình trước khi thay nước.\nLoại bỏ lá nằm dưới mặt nước.\nĐặt hoa ở nơi mát, tránh nắng trực tiếp và trái cây chín.",
      image: "/images/garden.webp",
    },
    {
      kind: "faq",
      slug: "flower-substitution",
      title: "Hoa thực tế có giống ảnh không?",
      body: "Chúng tôi giữ tinh thần, bảng màu và giá trị bó hoa. Vì hoa theo mùa, cửa hàng sẽ trao đổi trước nếu cần thay thế loại hoa.",
    },
    {
      kind: "faq",
      slug: "membership-terms",
      title: "Quyền lợi hội viên được tính thế nào?",
      body: "Đăng ký miễn phí sau khi xác minh tài khoản. Mỗi tháng có N đơn được dùng ưu đãi theo cấu hình công bố. Hết lượt vẫn mua theo giá thường. Lượt không tự chuyển sang tháng sau; không cộng dồn với voucher tiền hàng khác.",
    },
    {
      kind: "faq",
      slug: "streak-terms",
      title: "Một ngày có hoa được tính thế nào?",
      body: "Quét QR hợp lệ và đăng nhập để nhận tối đa một ngày mỗi ngày theo giờ Hà Nội. Một QR chỉ được dùng một lần cho mỗi tài khoản và có giới hạn người nhận. Tiến độ liên tiếp và tích lũy tháng được tính riêng. Chương trình có ngân sách giới hạn; ưu đãi đã cấp hiển thị trong ví của bạn.",
    },
  ];
  for (const c of content)
    await db.content.upsert({ where: { slug: c.slug }, update: {}, create: c });
  if (
    process.env.NODE_ENV !== "production" &&
    !existsSync(".local-access.txt")
  ) {
    const password = `Flr!${randomBytes(9).toString("base64url")}`;
    for (const [email, name, role] of [
      ["admin@fleurious.local", "Fleurious Admin", "OWNER"],
      ["hello@fleurious.local", "An Nhiên", "CUSTOMER"],
    ])
      await db.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name,
          role,
          verified: true,
          passwordHash: await hash(password, 12),
          memberSince: role === "CUSTOMER" ? new Date() : null,
        },
      });
    writeFileSync(
      ".local-access.txt",
      `Chỉ dùng cho môi trường local. Không commit file này.\nAdmin: admin@fleurious.local\nKhách: hello@fleurious.local\nMật khẩu cho hai tài khoản: ${password}\n`,
    );
  }
  console.log(
    "Đã seed sản phẩm, vùng giao, slot, nội dung và tài khoản local. Xem .local-access.txt.",
  );
}
main().finally(() => db.$disconnect());
