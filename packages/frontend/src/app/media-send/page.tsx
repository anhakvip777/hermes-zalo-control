import { Card, PageHeader } from "../../components/ui/dark";

export default function MediaSendPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="📤 Gửi Media"
        subtitle="Media send đang bị vô hiệu hóa trong remediation dashboard"
      />
      <Card>
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-5">
          <h2 className="text-base font-semibold text-amber-300">Media send chưa khả dụng từ dashboard</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Upload, staging và gửi media cần một capability gate riêng với storage bền vững,
            idempotency và audit evidence. Trang này hiện chỉ hiển thị trạng thái và không có
            file picker, upload endpoint, object URL hoặc nút gửi Zalo.
          </p>
          <p className="mt-3 text-xs text-slate-500">Không có thao tác outbound nào được thực hiện.</p>
        </div>
      </Card>
    </div>
  );
}
