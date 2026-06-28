import { getZaloGateway } from "./src/services/zalo-gateway.service.js";

async function main() {
  const gw = getZaloGateway();
  if (!gw.isConnected()) {
    console.log(JSON.stringify({ success: false, error: "ZALO_NOT_CONNECTED" }));
    process.exit(1);
  }

  const api = gw.getApi();
  if (!api) {
    console.log(JSON.stringify({ success: false, error: "ZALO_API_UNAVAILABLE" }));
    process.exit(1);
  }

  const opts = {
    question: "Điểm Danh Lễ Phật Hàng Ngày từ 27/6 - 26/7",
    options: [
      "27/6", "28/6", "29/6", "30/6", "01/7", "02/7", "03/7", "04/7", "05/7",
      "06/7", "07/7", "08/7", "09/7", "10/7", "11/7", "12/7", "13/7", "14/7",
      "15/7", "16/7", "17/7", "18/7", "19/7", "20/7", "21/7", "22/7", "23/7",
      "24/7", "25/7", "26/7"
    ],
    expiredTime: 0,
    allowMultiChoices: true,
    allowAddNewOption: true,
    hideVotePreview: false,
    isAnonymous: false,
  };

  try {
    const result = await api.createPoll(opts, "7977263179157568314");
    console.log(JSON.stringify({
      success: true,
      pollId: (result as any)?.pollId ?? (result as any)?.id ?? "unknown",
      msgId: (result as any)?.msgId ?? (result as any)?.messageId ?? "unknown",
      question: (result as any)?.question,
      optionsCount: (result as any)?.options?.length ?? opts.options.length,
    }));
  } catch (err: any) {
    console.log(JSON.stringify({
      success: false,
      error: err?.message ?? String(err),
      errorCode: "CREATE_POLL_FAILED",
    }));
  }
  process.exit(0);
}

main();
