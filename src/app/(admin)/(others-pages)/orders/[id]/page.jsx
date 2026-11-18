import { redirect } from "next/navigation";

export default async function LegacyOrderDetailsRedirect({ params }) {
  const { id } = await params;
  redirect(`/orders/music/${id}`);
}
