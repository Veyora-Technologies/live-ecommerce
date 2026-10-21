import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { merchantRole, canManageTeam, MERCHANT_ROLES } from "@/lib/permissions";

export async function GET(req: NextRequest){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const merchantId=new URL(req.url).searchParams.get("merchantId");
  if(!merchantId) return NextResponse.json({error:"merchantId required"},{status:400});
  const role=await merchantRole(merchantId,user.id);
  if(!role) return NextResponse.json({error:"Forbidden"},{status:403});
  const members=await prisma.merchantMembership.findMany({ where:{ merchantId, status:"ACTIVE" }, include:{ user:{ select:{ id:true, name:true, email:true } } }, orderBy:{ createdAt:"asc" }});
  return NextResponse.json({ myRole: role, members: members.map(m=>({ id:m.id, userId:m.userId, name:m.user.name, email:m.user.email, role:m.role, status:m.status, createdAt:m.createdAt })), roles: MERCHANT_ROLES });
}

export async function POST(req: NextRequest){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const { merchantId, emailOrPhone, role }=await req.json();
  if(!merchantId||!emailOrPhone) return NextResponse.json({error:"Missing fields"},{status:400});
  const myRole=await merchantRole(merchantId,user.id);
  if(!canManageTeam(myRole)) return NextResponse.json({error:"Only owners/managers can manage the team"},{status:403});
  const newRole=(MERCHANT_ROLES as readonly string[]).includes(role) && role!=="OWNER" ? role : "READ_ONLY";
  const invitee=await prisma.user.findFirst({ where:{ OR:[{email:emailOrPhone},{phone:emailOrPhone}] }});
  if(!invitee) return NextResponse.json({error:"No Live user with that email/phone. Ask them to create a free account first."},{status:404});
  const member=await prisma.merchantMembership.upsert({
    where:{ merchantId_userId:{ merchantId, userId:invitee.id } },
    update:{ role:newRole, status:"ACTIVE" },
    create:{ merchantId, userId:invitee.id, role:newRole },
  });
  await prisma.auditLog.create({ data:{ actorId:user.id, action:"TEAM_ADD", resourceType:"Merchant", resourceId:merchantId, metadata: JSON.stringify({ userId:invitee.id, role:newRole }) }});
  await prisma.notification.create({ data:{ recipientId:invitee.id, type:"TEAM_INVITE", title:"Added to a business team", body:`You were added as ${newRole}. Permissions apply immediately.`, resourceType:"Merchant", resourceId:merchantId }});
  return NextResponse.json({ member });
}

export async function DELETE(req: NextRequest){
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const { merchantId, userId }=await req.json().catch(()=>({}));
  const myRole=await merchantRole(merchantId,user.id);
  if(!canManageTeam(myRole)) return NextResponse.json({error:"Forbidden"},{status:403});
  await prisma.merchantMembership.deleteMany({ where:{ merchantId, userId, role:{ not:"OWNER" } }});
  await prisma.auditLog.create({ data:{ actorId:user.id, action:"TEAM_REMOVE", resourceType:"Merchant", resourceId:merchantId, metadata: JSON.stringify({ userId }) }});
  return NextResponse.json({ ok:true });
}
