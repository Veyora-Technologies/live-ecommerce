import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertDemoSeedAllowed, readDemoPasswords } from "./seed-safety";

const prisma = new PrismaClient();

async function main() {
  assertDemoSeedAllowed("base sample seed");
  const { userPassword, adminPassword } = readDemoPasswords();
  console.log("Seeding Furnivo demo data into the explicitly allowed local SQLite fixture...");

  // clean
  await prisma.notification.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.availabilityEvent.deleteMany();
  await prisma.savedItem.deleteMany();
  await prisma.report.deleteMany();
  await prisma.product.deleteMany();
  await prisma.merchantMembership.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.address.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  const pw = await bcrypt.hash(userPassword, 12);
  const adminPw = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.create({
    data: { name: "Furnivo Admin", email: "admin@live.ng", phone: "08000000001", passwordHash: adminPw, role: "ADMIN", isAdmin: true, adminRole: "SUPER" }
  });
  const consumer = await prisma.user.create({
    data: { name: "Amina Yusuf", email: "amina@example.com", phone: "08012345678", passwordHash: pw, role: "CONSUMER", preferredArea: "Wuse" }
  });
  await prisma.user.create({
    data: { name: "Emeka Okafor", email: "emeka@example.com", phone: "08087654321", passwordHash: pw, role: "CONSUMER", preferredArea: "Garki" }
  });

  // merchants
  const merchantsData = [
    {
      businessName: "HealthPlus Pharmacy Wuse 2",
      category: "PHARMACY",
      description: "24/7 pharmacy with licensed pharmacists. Prescription & OTC medicines, skincare, baby care.",
      address: "Plot 12, Adetokunbo Ademola Crescent, Wuse 2",
      area: "Wuse",
      lat: 9.0612, lng: 7.4615,
      phone: "08033001122",
      email: "wuse2@healthplus.ng",
      whatsapp: "08033001122",
      imageUrl: "https://images.unsplash.com/photo-1579154204601-01588f351e67?w=600",
      storeStatus: "OPEN",
      verificationStatus: "VERIFIED",
      status: "APPROVED",
      reliabilityScore: 92,
      confirmationRate: 96,
      openingHours: JSON.stringify({mon:"08:00-22:00",tue:"08:00-22:00",wed:"08:00-22:00",thu:"08:00-22:00",fri:"08:00-22:00",sat:"09:00-21:00",sun:"10:00-20:00"}),
    },
    {
      businessName: "MedPlus Garki",
      category: "PHARMACY",
      description: "Trusted community pharmacy in Garki. Genuine drugs, quick service.",
      address: "135 Adetokunbo Ademola Crescent, Garki Area 11",
      area: "Garki",
      lat: 9.0317, lng: 7.4856,
      phone: "08044556677",
      email: "garki@medplus.ng",
      storeStatus: "OPEN",
      verificationStatus: "VERIFIED",
      status: "APPROVED",
      reliabilityScore: 88,
      confirmationRate: 91,
      imageUrl: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=600",
    },
    {
      businessName: "H-Medix Maitama",
      category: "PHARMACY",
      description: "Premium pharmacy & wellness store. Imports, supplements, medical equipment.",
      address: "45 Lake Chad Crescent, Maitama",
      area: "Maitama",
      lat: 9.0793, lng: 7.4938,
      phone: "08098761234",
      storeStatus: "OPEN",
      verificationStatus: "VERIFIED",
      status: "APPROVED",
      reliabilityScore: 94,
      confirmationRate: 98,
      imageUrl: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=600",
    },
    {
      businessName: "Next Cash & Carry Supermarket",
      category: "SUPERMARKET",
      description: "Large supermarket with groceries, provisions, electronics.",
      address: "Plot 4565, Adetokunbo Ademola Cres, Wuse 2",
      area: "Wuse",
      lat: 9.0645, lng: 7.4550,
      phone: "08055667788",
      verificationStatus: "VERIFIED",
      status: "APPROVED",
      reliabilityScore: 85,
      imageUrl: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=600",
    },
    {
      businessName: "Sahad Stores Gwarimpa",
      category: "SUPERMARKET",
      description: "Everyday essentials at fair prices. Bulk discounts available.",
      address: "4th Avenue, Gwarimpa Estate",
      area: "Gwarimpa",
      lat: 9.1085, lng: 7.4105,
      phone: "08099887766",
      verificationStatus: "VERIFIED",
      status: "APPROVED",
      storeStatus: "OPEN",
      imageUrl: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600",
    },
    {
      businessName: "Abuja Central Chemist",
      category: "CHEMIST",
      description: "Affordable chemist for everyday medicines.",
      address: "Central Area, Herbert Macaulay Way",
      area: "Central Area",
      lat: 9.0550, lng: 7.4910,
      phone: "08011223344",
      verificationStatus: "PENDING",
      status: "APPROVED",
      imageUrl: "https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=600",
    },
  ];

  const owners: any[] = [];
  for (let i=0; i<merchantsData.length; i++) {
    const md = merchantsData[i];
    // create owner user for each merchant
    const owner = await prisma.user.create({
      data: { name: `${md.businessName} Owner`, email: `owner${i}@live.ng`, phone: `0809990000${i}`, passwordHash: pw, role: "MERCHANT" }
    });
    const merchant = await prisma.merchant.create({
      data: {
        ownerId: owner.id,
        businessName: md.businessName,
        category: md.category,
        description: md.description,
        address: md.address,
        area: md.area!,
        city: "Abuja",
        lat: md.lat,
        lng: md.lng,
        phone: md.phone!,
        email: (md as any).email,
        whatsapp: (md as any).whatsapp,
        imageUrl: md.imageUrl,
        storeStatus: (md as any).storeStatus || "OPEN",
        verificationStatus: md.verificationStatus!,
        status: md.status!,
        reliabilityScore: md.reliabilityScore,
        confirmationRate: (md as any).confirmationRate,
        openingHours: (md as any).openingHours || JSON.stringify({mon:"08:00-20:00",tue:"08:00-20:00",wed:"08:00-20:00",thu:"08:00-20:00",fri:"08:00-20:00",sat:"09:00-18:00",sun:"10:00-18:00"}),
        pickupAvailable: true,
        deliveryAvailable: i % 2 === 0,
      }
    });
    await prisma.merchantMembership.create({
      data: { merchantId: merchant.id, userId: owner.id, role: "OWNER" }
    });
    owners.push({owner, merchant});
  }

  // products
  const productTemplates = [
    { name: "Paracetamol 500mg (Emzor) x20", category: "Pharmacy", brand:"Emzor", price: 120000, stock: 48, unit:"pack", image:"https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500", desc:"Effective pain relief and fever reduction." },
    { name: "Augmentin 625mg x14", category: "Pharmacy", brand:"GSK", price: 580000, stock: 12, unit:"pack", image:"https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500", desc:"Broad-spectrum antibiotic. Prescription required." },
    { name: "Vitamin C 1000mg x30", category: "Pharmacy", brand:"Nature's Bounty", price: 450000, stock: 3, unit:"bottle", image:"https://images.unsplash.com/photo-1550572017-edd951b46af7?w=500", desc:"Immune support supplement." },
    { name: "ORS Sachet (Oral Rehydration) x10", category: "Pharmacy", brand:"UNICEF", price: 180000, stock: 0, unit:"pack", image:"https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=500", desc:"Rehydration salts for diarrhoea." },
    { name: "Dettol Antiseptic 500ml", category: "Essentials", brand:"Dettol", price: 250000, stock: 22, unit:"bottle", image:"https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=500", desc:"Antiseptic liquid for wound care & household." },
    { name: "Peak Milk Powder 400g", category: "Grocery", brand:"Peak", price: 320000, stock: 30, unit:"tin", image:"https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500", desc:"Full cream milk powder." },
    { name: "Golden Penny Rice 5kg", category: "Grocery", brand:"Golden Penny", price: 850000, stock: 15, unit:"bag", image:"https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=500", desc:"Premium parboiled rice." },
    { name: "Indomie Noodles 120g x5", category: "Grocery", brand:"Indomie", price: 150000, stock: 50, unit:"pack", image:"https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=500", desc:"Chicken flavour instant noodles." },
    { name: "Coca-Cola 50cl", category: "Grocery", brand:"Coca-Cola", price: 40000, stock: 100, unit:"bottle", image:"https://images.unsplash.com/photo-1553456558-aff63285bdd1?w=500", desc:"Chilled soft drink." },
    { name: "Phone Charger FastCharge USB-C", category: "Essentials", brand:"Oraimo", price: 450000, stock: 8, unit:"pcs", image:"https://images.unsplash.com/photo-1583394838336-acd977736f90?w=500", desc:"Fast charging USB-C cable + adapter." },
  ];

  for (const {merchant} of owners) {
    for (let j=0; j<productTemplates.length; j++) {
      const t = productTemplates[j];
      // vary stock per merchant slightly
      const variance = Math.floor(Math.random()*6)-2;
      const stock = Math.max(0, t.stock + variance - (merchant.area === "Gwarimpa" ? 2:0));
      const avail = stock ===0 ? "OUT_OF_STOCK" : stock <=5 ? "LOW_STOCK" : "IN_STOCK";
      await prisma.product.create({
        data: {
          merchantId: merchant.id,
          name: t.name,
          category: t.category,
          brand: t.brand,
          description: t.desc,
          price: t.price + (Math.floor(Math.random()*3)-1)*10000, // small price variance
          stockQuantity: stock,
          lowStockThreshold: 5,
          unit: t.unit,
          imageUrl: t.image,
          availability: avail,
          lastConfirmedAt: new Date(Date.now() - Math.floor(Math.random()*20)*3600000),
        }
      });
    }
  }

  console.log("Seed done: users", admin.email, consumer.email);
}

main().catch(e=>{console.error(e); process.exit(1)}).finally(async()=>{await prisma.$disconnect()})
