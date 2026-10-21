import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req:NextRequest, {params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const { emailOrPhone }=await req.json();
  const list=await prisma.shoppingList.findUnique({ where:{id}});
  if(!list) return NextResponse.json({error:"Not found"},{status:404});
  if(list.ownerId!==user.id) return NextResponse.json({error:"Only owner can invite"},{status:403});
  // find user to invite
  let invitee=null;
  if(emailOrPhone){
    invitee=await prisma.user.findFirst({ where:{ OR:[{email:emailOrPhone},{phone:emailOrPhone}]}});
    if(!invitee) return NextResponse.json({error:"User not found"},{status:404});
  }
  if(!invitee) return NextResponse.json({error:"Provide emailOrPhone"},{status:400});
  const member=await prisma.shoppingListMember.create({ data:{ listId:id, userId:invitee.id, role:"MEMBER"}});
  await prisma.notification.create({ data:{ recipientId: invitee.id, type:"LIST_INVITE", title:"You were added to a list", body:`${user.name} added you to "${list.name}"`, resourceType:"ShoppingList", resourceId:id }});
  return NextResponse.json({ member });
}
