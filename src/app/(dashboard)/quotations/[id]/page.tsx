import { QuotationEditor } from '@/components/quotations/quotation-editor';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuotationEditor id={id} />;
}
