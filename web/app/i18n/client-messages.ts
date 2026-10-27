import {
  defineMessages,
  translateKnownMessage,
  translateMessage,
  type WorkstationLocale,
} from './core';

/** Exact client-owned diagnostics only. Never apply this catalog to logs or daemon detail. */
const vietnamese: Record<string, string> = {
  'Storage paths must be safe absolute paths without traversal.':
    'Đường dẫn lưu trữ phải là đường dẫn tuyệt đối an toàn, không có thành phần đi lên thư mục.',
  'Use a safe absolute storage root without parent traversal.':
    'Dùng thư mục gốc lưu trữ tuyệt đối an toàn, không đi lên thư mục cha.',
  'Storage mapping path platforms must match.':
    'Nền tảng đường dẫn trong ánh xạ lưu trữ phải trùng nhau.',
  'Storage host roots must be unique.': 'Các thư mục gốc máy chủ phải là duy nhất.',
  'Mapped plots require the original approved host request':
    'Đồ thị có ánh xạ yêu cầu bản gốc đã phê duyệt từ máy chủ.',
  'Approved storage mapping differs from the submitted request':
    'Ánh xạ lưu trữ đã phê duyệt khác với yêu cầu đã gửi.',
  'Approved host paths do not match normalized execution paths':
    'Đường dẫn máy chủ đã phê duyệt không khớp đường dẫn thực thi đã chuẩn hóa.',
  'Approved registrations do not match normalized execution paths':
    'Đường dẫn đăng ký mô hình đã phê duyệt không khớp đường dẫn thực thi đã chuẩn hóa.',
  'Automatic plots require a verified connection':
    'Tạo đồ thị tự động yêu cầu kết nối đã xác minh.',
  'Source approval scope changed': 'Phạm vi phê duyệt nguồn đã thay đổi.',
  'Missing approved manifests': 'Thiếu bản kê đã phê duyệt.',
  'Invalid plot manifest': 'Bản kê đồ thị không hợp lệ.',
  'Plot normalization changed approved authority':
    'Chuẩn hóa đồ thị đã thay đổi phạm vi được phê duyệt.',
  'Plot configuration changed approved intent':
    'Cấu hình đồ thị đã thay đổi yêu cầu được phê duyệt.',
  'Automatic plot preview differs from approved training authority. Use explicit result planning.':
    'Bản xem trước đồ thị tự động khác phạm vi huấn luyện đã phê duyệt. Hãy lập kế hoạch kết quả tường minh.',
  'Invalid cross-validation summary.': 'Tóm tắt kiểm định chéo không hợp lệ.',
  'Select a cross-validation summary within the 1 MiB limit.':
    'Chọn một tóm tắt kiểm định chéo trong giới hạn 1 MiB.',
  'Invalid adoption acknowledgement.': 'Xác nhận tiếp nhận không hợp lệ.',
  'Choose a daemon run directory.': 'Chọn thư mục tác vụ trên daemon.',
  'Wait for the current adoption acknowledgement.': 'Chờ xác nhận tiếp nhận hiện tại.',
  'Revalidate the same directory and attempt before retrying the retained request.':
    'Xác thực lại cùng thư mục và lần chạy trước khi thử lại yêu cầu đã giữ.',
  'Select a daemon directory and attempt first.': 'Trước tiên, chọn thư mục daemon và lần chạy.',
  'An adoption request is already pending.': 'Một yêu cầu tiếp nhận đang chờ xử lý.',
  'The daemon rejected adoption. No ownership confirmation was received.':
    'Daemon đã từ chối tiếp nhận. Chưa nhận được xác nhận quyền quản lý.',
  'Adoption acknowledgement is unknown. Reconnect and reselect the same directory and attempt, then retry the retained request.':
    'Chưa rõ kết quả xác nhận tiếp nhận. Kết nối lại, chọn lại cùng thư mục và lần chạy, rồi thử lại yêu cầu đã giữ.',
  'Not a raster PNG.': 'Không phải ảnh raster PNG.',
  'PNG exceeds the browser preview pixel budget.':
    'Ảnh PNG vượt giới hạn điểm ảnh cho bản xem trước trong trình duyệt.',
  'Invalid published artifact inventory': 'Danh mục tệp kết quả đã công bố không hợp lệ',
  'Invalid run identity': 'Định danh tác vụ không hợp lệ',
  'Refresh artifacts on the current connection.': 'Làm mới tệp kết quả trên kết nối hiện tại.',
  'This artifact exceeds the 64 MiB browser memory budget. Use the CLI to export it.':
    'Tệp kết quả vượt giới hạn bộ nhớ trình duyệt 64 MiB. Dùng CLI để xuất tệp.',
  'Artifact response does not match its inventory.':
    'Phản hồi tệp kết quả không khớp với danh mục.',
  'Artifact exceeds declared size.': 'Tệp kết quả vượt kích thước đã khai báo.',
  'Artifact is truncated.': 'Tệp kết quả bị thiếu dữ liệu.',
  'Artifact checksum changed.': 'Giá trị kiểm tra toàn vẹn của tệp kết quả đã thay đổi.',
  'Artifact provenance cannot fit a safe download filename.':
    'Thông tin nguồn gốc tệp kết quả không thể tạo thành tên tải xuống an toàn.',
  'Artifact paths cannot fit distinct safe download filenames.':
    'Các đường dẫn tệp kết quả không thể tạo thành các tên tải xuống an toàn và khác nhau.',
  'Select bounded checkpoint classification metadata.':
    'Chọn siêu dữ liệu phân loại checkpoint trong giới hạn cho phép.',
  'Missing approved manifest': 'Thiếu bản kê đã duyệt',
  'Unsupported approved training manifest': 'Bản kê huấn luyện đã duyệt không được hỗ trợ',
  'Automatic plots require an explicit mapped-path contract for this manifest':
    'Vẽ tự động yêu cầu hợp đồng ánh xạ đường dẫn rõ ràng cho bản kê này',
  'Unsupported normalized training configuration':
    'Cấu hình huấn luyện chuẩn hóa không được hỗ trợ',
  'Invalid automatic plot deadline': 'Thời hạn vẽ tự động không hợp lệ',
  'Automatic plot workflow capacity reached. Use explicit result planning.':
    'Đã đạt giới hạn quy trình vẽ tự động. Hãy lập kế hoạch kết quả thủ công.',
  'Unsupported captured native scope': 'Phạm vi chạy gốc đã ghi nhận không được hỗ trợ',
  'Diagnostic plots will use this approved training run’s published best checkpoint.':
    'Biểu đồ chẩn đoán sẽ dùng checkpoint tốt nhất đã công bố của tác vụ huấn luyện đã duyệt này.',
  'Automatic plots unavailable: approved manifest is unsupported. Use explicit result planning.':
    'Không thể vẽ tự động: bản kê đã duyệt không được hỗ trợ. Hãy lập kế hoạch kết quả thủ công.',
  'Automatic plots unavailable: the published checkpoint is incomplete.':
    'Không thể vẽ tự động: checkpoint đã công bố chưa hoàn chỉnh.',
  'Automatic plot acknowledgment is unconfirmed. Retry explicitly on this connection; the same plan and key are retained.':
    'Chưa xác nhận yêu cầu vẽ tự động. Hãy chủ động thử lại trên kết nối này; kế hoạch và khóa cũ được giữ nguyên.',
  'Automatic plot identity changed': 'Định danh vẽ tự động đã thay đổi',
  'Automatic plot acknowledgment does not match the persisted plan':
    'Xác nhận vẽ tự động không khớp với kế hoạch đã lưu',
  'Daemon acknowledged the diagnostic plot run.': 'Daemon đã xác nhận tác vụ vẽ biểu đồ chẩn đoán.',
  'Auto-plot belongs to a submitted training workflow.':
    'Vẽ tự động thuộc một quy trình huấn luyện đã gửi.',
  'Auto-plot has no eligible captured intent.':
    'Vẽ tự động chưa có yêu cầu đã ghi nhận đủ điều kiện.',
  'Auto-plot must use its persisted plan.': 'Vẽ tự động phải dùng kế hoạch đã lưu.',
  'Invalid daemon catalog response': 'Phản hồi danh mục daemon không hợp lệ',
  'Select again from the current verified daemon.': 'Chọn lại từ daemon đã xác thực hiện tại.',
  'Invalid browse location.': 'Vị trí duyệt không hợp lệ.',
  'Invalid browse selection.': 'Mục được chọn khi duyệt không hợp lệ.',
  'Reload the model catalogue before selecting.': 'Tải lại danh mục mô hình trước khi chọn.',
  'Enter a bounded model registry identifier, not a path or expression.':
    'Nhập định danh mô hình trong giới hạn cho phép, không nhập đường dẫn hay biểu thức.',
  'Invalid connection deadline': 'Thời hạn kết nối không hợp lệ',
  'Reconnect explicitly to verify the daemon again.':
    'Chủ động kết nối lại để xác thực daemon lần nữa.',
  'Offline: live status and actions are unavailable.':
    'Ngoại tuyến: không có trạng thái trực tiếp và không thể thao tác.',
  'Enter the daemon bearer credential.': 'Nhập thông tin xác thực bearer của daemon.',
  'Connect to a verified daemon before using live actions.':
    'Kết nối với daemon đã xác thực trước khi dùng thao tác trực tiếp.',
  'The connection scope changed; discard this result.':
    'Phạm vi kết nối đã thay đổi; bỏ kết quả này.',
  'Invalid request deadline.': 'Thời hạn yêu cầu không hợp lệ.',
  'The request was interrupted or timed out; verify its outcome before retrying.':
    'Yêu cầu bị gián đoạn hoặc hết thời gian; kiểm tra kết quả trước khi thử lại.',
  'Credential expired or rejected; enter it again.':
    'Thông tin xác thực đã hết hạn hoặc bị từ chối; nhập lại.',
  'Daemon identity, build or protocol changed. Update the client or explicitly disconnect before changing daemon scope.':
    'Định danh, bản dựng hoặc giao thức daemon đã thay đổi. Cập nhật ứng dụng hoặc chủ động ngắt kết nối trước khi đổi phạm vi daemon.',
  'The daemon returned an invalid response. Reconnect to verify its identity.':
    'Daemon trả về phản hồi không hợp lệ. Kết nối lại để xác thực định danh.',
  'The daemon request failed. Verify connectivity and the operation outcome before retrying.':
    'Yêu cầu daemon thất bại. Kiểm tra kết nối và kết quả thao tác trước khi thử lại.',
  'Pending native evidence cannot advertise a current runtime':
    'Bằng chứng chạy gốc đang chờ không thể công bố môi trường chạy hiện tại',
  'Invalid run response identity or state':
    'Định danh hoặc trạng thái trong phản hồi tác vụ không hợp lệ',
  'JSON exceeds complexity limits': 'JSON vượt giới hạn độ phức tạp',
  'Invalid JSON value': 'Giá trị JSON không hợp lệ',
  'JSON exceeds byte limit': 'JSON vượt giới hạn số byte',
  'Malformed JSON response': 'Phản hồi JSON sai cấu trúc',
  'Duplicate JSON member': 'Thành viên JSON bị trùng',
  'Expected a JSON response': 'Yêu cầu phản hồi JSON',
  'Missing response body': 'Thiếu nội dung phản hồi',
  'Daemon response timed out': 'Phản hồi daemon đã hết thời gian',
  'Response exceeds byte limit': 'Phản hồi vượt giới hạn số byte',
  'Invalid UTF-8 response': 'Phản hồi UTF-8 không hợp lệ',
  'Expected an HTTP origin': 'Yêu cầu nguồn gốc HTTP',
  'Daemon API must use the current browser origin':
    'API daemon phải dùng nguồn gốc trình duyệt hiện tại',
  'Invalid daemon identity pins': 'Định danh daemon đã ghim không hợp lệ',
  'Invalid bearer credential': 'Thông tin xác thực bearer không hợp lệ',
  'Bootstrap origin differs': 'Nguồn gốc khởi tạo không khớp',
  'Ambiguous bootstrap credential': 'Thông tin xác thực khởi tạo không rõ ràng',
  'Invalid bootstrap response': 'Phản hồi khởi tạo không hợp lệ',
  'Invalid daemon health response': 'Phản hồi tình trạng daemon không hợp lệ',
  'Daemon protocol mismatch; update the daemon or client':
    'Giao thức daemon không khớp; cập nhật daemon hoặc ứng dụng',
  'Daemon identity or build changed; reconnect explicitly':
    'Định danh hoặc bản dựng daemon đã thay đổi; chủ động kết nối lại',
  'Invalid artifact download route': 'Đường dẫn tải tệp kết quả không hợp lệ',
  'Connection credential changed during download':
    'Thông tin xác thực kết nối đã thay đổi trong khi tải',
  'Invalid run pagination': 'Phân trang tác vụ không hợp lệ',
  'Invalid run list': 'Danh sách tác vụ không hợp lệ',
  'Invalid idempotency key': 'Khóa chống lặp yêu cầu không hợp lệ',
  'Connection credential changed during request':
    'Thông tin xác thực kết nối đã thay đổi trong khi gửi yêu cầu',
  'Invalid plan response': 'Phản hồi kế hoạch không hợp lệ',
  'Plan lacks a verified daemon identity': 'Kế hoạch thiếu định danh daemon đã xác thực',
  'Plan belongs to another connection; preview it again':
    'Kế hoạch thuộc kết nối khác; xem trước lại',
  'Invalid approved plan identity': 'Định danh kế hoạch đã duyệt không hợp lệ',
  'Submission does not belong to approved plan': 'Yêu cầu gửi không thuộc kế hoạch đã duyệt',
  'Invalid event cursor': 'Con trỏ sự kiện không hợp lệ',
  'Event cursor belongs to another daemon': 'Con trỏ sự kiện thuộc daemon khác',
  'Expected an event stream': 'Yêu cầu luồng sự kiện',
  'API requests must remain same-origin': 'Yêu cầu API phải giữ cùng nguồn gốc',
  'Credentials must not appear in API URLs':
    'Thông tin xác thực không được xuất hiện trong URL API',
  'Request exceeds byte limit': 'Yêu cầu vượt giới hạn số byte',
  'Enter the daemon bearer credential': 'Nhập thông tin xác thực bearer của daemon',
  'Daemon request timed out': 'Yêu cầu daemon đã hết thời gian',
  'Credential expired or rejected; enter it again':
    'Thông tin xác thực đã hết hạn hoặc bị từ chối; nhập lại',
  'Dataset header metadata cannot be mapped safely.':
    'Không thể ánh xạ an toàn siêu dữ liệu phần đầu tập dữ liệu.',
  'Select a supported dataset file from this daemon.':
    'Chọn tệp dữ liệu được hỗ trợ từ daemon này.',
  'Invalid bounded dataset preview response.':
    'Phản hồi xem trước tập dữ liệu trong giới hạn không hợp lệ.',
  'Invalid cursor storage scope': 'Phạm vi lưu con trỏ không hợp lệ',
  'Invalid cursor': 'Con trỏ không hợp lệ',
  'Malformed or unsafe run event JSON': 'JSON sự kiện tác vụ sai cấu trúc hoặc không an toàn',
  'Invalid run event ownership, version or cursor':
    'Quyền quản lý, phiên bản hoặc con trỏ sự kiện tác vụ không hợp lệ',
  'Invalid event timestamp': 'Thời điểm sự kiện không hợp lệ',
  'Invalid cursor or run identity': 'Con trỏ hoặc định danh tác vụ không hợp lệ',
  'Invalid UTF-8 stream': 'Luồng UTF-8 không hợp lệ',
  'Truncated UTF-8 stream': 'Luồng UTF-8 bị thiếu dữ liệu',
  'Stream line exceeds limit': 'Dòng trong luồng vượt giới hạn',
  'Stream frame exceeds limit': 'Khung trong luồng vượt giới hạn',
  'Ambiguous event id': 'Định danh sự kiện không rõ ràng',
  'Ambiguous event type': 'Loại sự kiện không rõ ràng',
  'Invalid stream control': 'Điều khiển luồng không hợp lệ',
  'Stream control cannot advertise uncommitted progress':
    'Điều khiển luồng không thể công bố tiến độ chưa được ghi nhận',
  'Unsupported stream event': 'Sự kiện luồng không được hỗ trợ',
  'Event cursor belongs to another run': 'Con trỏ sự kiện thuộc tác vụ khác',
  'Missing event stream': 'Thiếu luồng sự kiện',
  'Invalid metric payload': 'Dữ liệu chỉ số không hợp lệ',
  'Invalid metric details': 'Chi tiết chỉ số không hợp lệ',
  'Invalid per-parameter metrics': 'Chỉ số theo tham số không hợp lệ',
  'Metric scope belongs to another run': 'Phạm vi chỉ số thuộc tác vụ khác',
  'Invalid verified generation': 'Thế hệ đã xác thực không hợp lệ',
  'Metric generation capacity exceeded': 'Vượt giới hạn số thế hệ chỉ số',
  'Invalid metric event ownership': 'Quyền quản lý sự kiện chỉ số không hợp lệ',
  'Metric attempt capacity exceeded': 'Vượt giới hạn số lần chạy chỉ số',
  'Metric history capacity exceeded; replay with a larger limit':
    'Lịch sử chỉ số vượt giới hạn; phát lại với giới hạn lớn hơn',
  'Invalid supersession boundary': 'Ranh giới thay thế không hợp lệ',
  'Supersession references an absent step': 'Thông tin thay thế tham chiếu bước không tồn tại',
  'Attempt already has a supersession boundary': 'Lần chạy đã có ranh giới thay thế',
  'Invalid daemon identity.': 'Định danh daemon không hợp lệ.',
  'Preferences exceed the 64 KiB limit.': 'Tùy chọn vượt giới hạn 64 KiB.',
  'Select the matching daemon dataset and model.': 'Chọn tập dữ liệu và mô hình daemon phù hợp.',
  'Validate the training draft first.': 'Trước tiên, kiểm tra bản nháp huấn luyện.',
  'Draft changed while planning; preview again.':
    'Bản nháp đã thay đổi khi lập kế hoạch; xem trước lại.',
  'Preview this draft on the current connection first.':
    'Trước tiên, xem trước bản nháp trên kết nối hiện tại.',
  'Preview again before checking submission.': 'Xem trước lại trước khi kiểm tra yêu cầu gửi.',
  'Run status does not belong to the approved plan.':
    'Trạng thái tác vụ không thuộc kế hoạch đã duyệt.',
  'Choose the exact source publication and daemon dataset.':
    'Chọn chính xác bản công bố nguồn và tập dữ liệu daemon.',
  'Draft changed; preview again.': 'Bản nháp đã thay đổi; xem trước lại.',
  'Choose an explicitly classified CV fold, never a summary.':
    'Chọn fold CV đã được phân loại rõ ràng, không chọn bản tổng hợp.',
  'Validate the inference draft first.': 'Trước tiên, kiểm tra bản nháp suy luận.',
  'Select and validate inference sources on the current connection first.':
    'Trước tiên, chọn và kiểm tra các nguồn suy luận trên kết nối hiện tại.',
  'Preview on the current connection first.': 'Trước tiên, xem trước trên kết nối hiện tại.',
  'Preview first.': 'Xem trước trước khi tiếp tục.',
  'Inference status belongs to a different plan.': 'Trạng thái suy luận thuộc kế hoạch khác.',
  'Connection interrupted; lifecycle is not confirmed.':
    'Kết nối bị gián đoạn; vòng đời chưa được xác nhận.',
  'Run response belongs to another run': 'Phản hồi tác vụ thuộc tác vụ khác',
  'Run ownership or operation changed': 'Quyền quản lý hoặc thao tác tác vụ đã thay đổi',
  'Runtime attempt regressed': 'Số lần chạy đã lùi lại',
  'Verified native generation disappeared': 'Thế hệ chạy gốc đã xác thực không còn tồn tại',
  'Pending native generation lacks identity': 'Thế hệ chạy gốc đang chờ thiếu định danh',
  'Invalid native generation ownership': 'Quyền quản lý thế hệ chạy gốc không hợp lệ',
  'Native generation ownership changed or regressed':
    'Quyền quản lý thế hệ chạy gốc đã thay đổi hoặc lùi lại',
  'Invalid native pending flag': 'Cờ chờ chạy gốc không hợp lệ',
  'Stream requires replay': 'Luồng cần được phát lại',
  'Cancellation response lost. Refresh or retry; the daemon may have accepted the request.':
    'Mất phản hồi hủy. Làm mới hoặc thử lại; daemon có thể đã chấp nhận yêu cầu.',
  'This exporter quotes POSIX shell commands only. Windows host commands require a Windows-specific exporter; use the YAML configuration.':
    'Bộ xuất này chỉ xử lý trích dẫn lệnh shell POSIX. Lệnh trên máy Windows cần bộ xuất dành riêng cho Windows; hãy dùng cấu hình YAML.',
  'Multi-node standalone commands require explicit rendezvous and are not exported by this editor.':
    'Lệnh độc lập nhiều nút yêu cầu cấu hình điểm hẹn rõ ràng và không được trình soạn thảo này xuất.',
  'Choose explicit CPU or CUDA for a reproducible standalone command.':
    'Chọn rõ CPU hoặc CUDA để tạo lệnh độc lập có thể tái lập.',
  'Container startup is operator-owned; a standalone host command cannot reproduce it.':
    'Khởi động container do người vận hành quản lý; lệnh độc lập trên máy chủ không thể tái lập thao tác này.',
  'Explicit environment values are not exported because they may contain secrets. Configure them safely on the host, or clear them before exporting a command.':
    'Không xuất giá trị biến môi trường vì chúng có thể chứa bí mật. Cấu hình an toàn trên máy chủ hoặc xóa chúng trước khi xuất lệnh.',
  'Incomplete training schema.': 'Lược đồ huấn luyện chưa đầy đủ.',
  'Standalone CLI list entries cannot start with an option prefix; use the YAML export.':
    'Mục danh sách CLI độc lập không được bắt đầu bằng tiền tố tùy chọn; hãy xuất YAML.',
  'Unable to refresh runs.': 'Không thể làm mới danh sách tác vụ.',
  'Choose a positive runtime attempt.': 'Chọn số lần chạy lớn hơn 0.',
  'Must be a valid URL': 'Phải là URL hợp lệ',
  'The credential is too long.': 'Thông tin xác thực quá dài.',
  'Enter a valid bearer credential.': 'Nhập thông tin xác thực bearer hợp lệ.',
  'NUL is not allowed.': 'Không cho phép ký tự NUL.',
  'Enter comma-separated finite numbers.': 'Nhập các số hữu hạn, phân cách bằng dấu phẩy.',
  'Enter two beta values in [0, 1).': 'Nhập hai giá trị beta trong khoảng [0, 1).',
  'Enter comma-separated epochs.': 'Nhập các epoch, phân cách bằng dấu phẩy.',
  'Choose an absolute daemon-host path.': 'Chọn đường dẫn tuyệt đối trên máy chủ daemon.',
  'Scheduler and launcher identity variables are daemon-owned.':
    'Biến định danh bộ lập lịch và trình khởi chạy do daemon quản lý.',
  'Rank must belong to the topology; at most 1024 processes.':
    'Rank phải thuộc cấu trúc liên kết; tối đa 1024 tiến trình.',
  'Slurm owns CUDA_VISIBLE_DEVICES; configure GPU resources through operator policy.':
    'Slurm quản lý CUDA_VISIBLE_DEVICES; cấu hình tài nguyên GPU theo chính sách vận hành.',
  'Enter a model registry identifier, not a path or expression.':
    'Nhập định danh mô hình trong registry, không nhập đường dẫn hay biểu thức.',
  'Daemon plans use this typed configuration, not a host YAML filename.':
    'Kế hoạch daemon dùng cấu hình có kiểu này, không dùng tên tệp YAML trên máy chủ.',
  'The daemon owns isolated run output directories.':
    'Daemon quản lý thư mục kết quả riêng biệt cho từng tác vụ.',
  'Model discovery is the authenticated catalogue.': 'Tra cứu mô hình dùng danh mục đã xác thực.',
  'CLI alias of precision; use the single precision field.':
    'Bí danh CLI của precision; dùng trường precision duy nhất.',
  'Invalid input': 'Dữ liệu nhập không hợp lệ',
  'Invalid UUID': 'UUID không hợp lệ',
  'Invalid URL': 'URL không hợp lệ',
  'Invalid string: must match pattern /^[A-Za-z_][A-Za-z0-9_]*$/':
    'Tên biến môi trường phải bắt đầu bằng chữ cái hoặc dấu gạch dưới, sau đó chỉ chứa chữ cái, chữ số hoặc dấu gạch dưới.',
  'Chart capacity exceeded (200000 metric records).':
    'Biểu đồ vượt giới hạn (200000 bản ghi chỉ số).',
  'maxPoints must be a positive safe integer': 'maxPoints phải là số nguyên dương an toàn',
};

// Closed schema choices: retain protocol values exactly as defined by shared schemas.
for (const values of [
  ['mse', 'mae', 'huber', 'smooth_l1', 'log_cosh', 'weighted_mse'],
  ['adamw', 'adam', 'sgd', 'nadam', 'radam', 'rmsprop'],
  [
    'plateau',
    'cosine',
    'cosine_restarts',
    'onecycle',
    'step',
    'multistep',
    'exponential',
    'linear_warmup',
  ],
  ['sha256', 'fast', 'size'],
  ['bf16', 'fp16', 'no'],
  ['mse', 'mae'],
  ['local', 'slurm'],
  ['existing', 'selected', 'bundled', 'container'],
  ['cpu', 'mps', 'cuda', 'auto'],
  ['auto', 'npz', 'mat', 'hdf5'],
  ['png', 'pdf', 'svg', 'eps', 'tiff'],
  ['test', 'plot'],
]) {
  const options = values.map((value) => `"${value}"`).join('|');
  vietnamese[`Invalid option: expected one of ${options}`] =
    `Chọn một trong các giá trị: ${options}`;
}

for (const expected of ['string', 'number', 'boolean', 'array', 'object', 'int']) {
  const labels: Record<string, string> = {
    string: 'chuỗi',
    number: 'số',
    boolean: 'giá trị đúng/sai',
    array: 'danh sách',
    object: 'đối tượng',
    int: 'số nguyên',
  };
  for (const received of [
    'string',
    'number',
    'boolean',
    'array',
    'object',
    'null',
    'undefined',
    'NaN',
  ])
    vietnamese[`Invalid input: expected ${expected}, received ${received}`] =
      `Giá trị phải là ${labels[expected]}`;
}

const english = Object.fromEntries(Object.keys(vietnamese).map((message) => [message, message]));
export const clientMessages = defineMessages(english, vietnamese);

const validationMessages = defineMessages(
  {
    stringMin: 'Too small: expected string to have >={limit} characters',
    stringMax: 'Too big: expected string to have <={limit} characters',
    arrayMin: 'Too small: expected array to have >={limit} items',
    arrayMax: 'Too big: expected array to have <={limit} items',
    numberMin: 'Too small: expected number to be >={limit}',
    numberMax: 'Too big: expected number to be <={limit}',
    numberGreater: 'Too small: expected number to be >{limit}',
    numberLess: 'Too big: expected number to be <{limit}',
    integer: 'Invalid input: expected int, received number',
    number: 'Invalid input: expected number, received NaN',
  },
  {
    stringMin: 'Cần ít nhất {limit} ký tự',
    stringMax: 'Cho phép tối đa {limit} ký tự',
    arrayMin: 'Cần ít nhất {limit} mục',
    arrayMax: 'Cho phép tối đa {limit} mục',
    numberMin: 'Giá trị phải lớn hơn hoặc bằng {limit}',
    numberMax: 'Giá trị phải nhỏ hơn hoặc bằng {limit}',
    numberGreater: 'Giá trị phải lớn hơn {limit}',
    numberLess: 'Giá trị phải nhỏ hơn {limit}',
    integer: 'Giá trị phải là số nguyên',
    number: 'Giá trị phải là số hợp lệ',
  },
);

const parameterMessages = defineMessages(
  {
    http: 'Daemon request failed ({status})',
    evidence: 'Invalid run evidence {field}',
    numeric: 'Invalid numeric metric {field}',
    integer: 'Invalid integer metric {field}',
  },
  {
    http: 'Yêu cầu daemon thất bại ({status})',
    evidence: 'Bằng chứng tác vụ không hợp lệ: {field}',
    numeric: 'Chỉ số dạng số không hợp lệ: {field}',
    integer: 'Chỉ số dạng số nguyên không hợp lệ: {field}',
  },
);

/** Presentation-only: no global Zod locale, schema or Error.message changes. */
export function translateClientMessage(locale: WorkstationLocale, rawEnglish: string): string {
  const known = translateKnownMessage(clientMessages, locale, rawEnglish);
  if (known !== rawEnglish || locale === 'en') return known;
  const validation = translateKnownMessage(validationMessages, locale, rawEnglish);
  if (validation !== rawEnglish) return validation;
  const status = /^Daemon request failed \(([1-5]\d{2})\)$/.exec(rawEnglish)?.[1];
  if (status) return translateMessage(parameterMessages, locale, 'http', { status });
  // Fixed protocol field identifiers are retained verbatim, not treated as free text.
  const evidence =
    /^Invalid run evidence (native_pending|native_identity|current_runtime_attempt|last_runtime_attempt|confidence|reason|runtime|backend|last_observation|batch|stage_out|status|exit_code|signal|detail|hello_seen|conflicting_exits|state|state_seq|exit_seq|outcome|native_state|attempt)$/.exec(
      rawEnglish,
    )?.[1];
  if (evidence) return translateMessage(parameterMessages, locale, 'evidence', { field: evidence });
  const numeric =
    /^Invalid numeric metric (train_loss|val_loss|best_val_loss|lr|r2|pearson|patience|patience_ctr|epoch_time|elapsed_time|grad_norm|mae_avg|val_r2|val_pearson|val_mae_avg|total_time|MAE_Phys_P\d{1,6})$/.exec(
      rawEnglish,
    )?.[1];
  if (numeric) return translateMessage(parameterMessages, locale, 'numeric', { field: numeric });
  const integer =
    /^Invalid integer metric (epoch|total_epochs|patience_counter|max_patience)$/.exec(
      rawEnglish,
    )?.[1];
  if (integer) return translateMessage(parameterMessages, locale, 'integer', { field: integer });
  // Anchored library-owned templates with numeric bounds only; never parse values or paths.
  for (const key of [
    'stringMin',
    'stringMax',
    'arrayMin',
    'arrayMax',
    'numberMin',
    'numberMax',
    'numberGreater',
    'numberLess',
  ] satisfies (keyof typeof validationMessages.en)[]) {
    const template = validationMessages.en[key];
    const [prefix, suffix = ''] = template.split('{limit}');
    if (!prefix || !rawEnglish.startsWith(prefix) || !rawEnglish.endsWith(suffix)) continue;
    const limit = rawEnglish.slice(prefix.length, suffix ? -suffix.length : undefined);
    if (
      limit.length <= 32 &&
      /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(limit) &&
      Number.isFinite(Number(limit))
    )
      return translateMessage(validationMessages, locale, key, { limit });
  }
  return rawEnglish;
}
