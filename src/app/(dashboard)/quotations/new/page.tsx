import { QuotationEditor } from '@/components/quotations/quotation-editor';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const params = await searchParams;
  return <QuotationEditor initialContact={params.contact} />;
}
