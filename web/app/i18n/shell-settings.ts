import { defineMessages } from './core';

/** Shell, connection, build-skew and browser-settings presentation only. */
export const shellSettingsMessages = defineMessages(
  {
    'Skip to workspace': 'Skip to workspace',
    'Workstation navigation': 'Workstation navigation',
    WORKSPACE: 'WORKSPACE',
    Sections: 'Sections',
    Experiments: 'Experiments',
    'New training run': 'New training run',
    Datasets: 'Datasets',
    Results: 'Results',
    'Adopt standalone run': 'Adopt standalone run',
    Connection: 'Connection',
    Settings: 'Settings',
    'Your compute. Your workspace.': 'Your compute. Your workspace.',
    'Execution belongs to the daemon.': 'Execution belongs to the daemon.',
    'Local-first computation': 'Local-first computation',
    Workstation: 'Workstation',
    Connected: 'Connected',
    Connecting: 'Connecting',
    Offline: 'Offline',
    'Not connected': 'Not connected',
    'WaveDL daemon interface · Development foundation':
      'WaveDL daemon interface · Development foundation',
    'YOUR COMPUTE. YOUR WORKSPACE.': 'YOUR COMPUTE. YOUR WORKSPACE.',
    'Connect to your daemon.': 'Connect to your daemon.',
    'Your daemon runs the experiments. This browser connects only to its current origin; credentials stay in memory.':
      'Your daemon runs the experiments. This browser connects only to its current origin; credentials stay in memory.',
    'Connection identity changed': 'Connection identity changed',
    'Connection status': 'Connection status',
    'A newer WaveDL build is available': 'A newer WaveDL build is available',
    Reload: 'Reload',
    'Connected to {daemonId} · build {buildId}': 'Connected to {daemonId} · build {buildId}',
    'Verify connection': 'Verify connection',
    Disconnect: 'Disconnect',
    'Daemon bearer credential': 'Daemon bearer credential',
    'Paste the credential provided by WaveDL. It is not saved to browser storage.':
      'Paste the credential provided by WaveDL. It is not saved to browser storage.',
    'Connecting…': 'Connecting…',
    'Connect securely': 'Connect securely',
    'Disconnect and clear scope': 'Disconnect and clear scope',
    'Disconnecting never cancels running jobs. An offline page cannot confirm live status or perform actions. A changed daemon identity requires an explicit disconnect before starting a new scope.':
      'Disconnecting never cancels running jobs. An offline page cannot confirm live status or perform actions. A changed daemon identity requires an explicit disconnect before starting a new scope.',
    'Appearance and guidance': 'Appearance and guidance',
    Appearance: 'Appearance',
    System: 'System',
    Light: 'Light',
    Dark: 'Dark',
    Accent: 'Accent',
    Neutral: 'Neutral',
    Blue: 'Blue',
    Violet: 'Violet',
    Green: 'Green',
    'Interface scale': 'Interface scale',
    Language: 'Language',
    'Choose the language used throughout this workstation.':
      'Choose the language used throughout this workstation.',
    'Show the new-project guide': 'Show the new-project guide',
    'Save appearance': 'Save appearance',
    'Discard changes': 'Discard changes',
    'Browser preferences saved.': 'Browser preferences saved.',
    'Applied for this session. Browser storage is unavailable.':
      'Applied for this session. Browser storage is unavailable.',
    'Changes apply immediately in this browser. They do not restart or reconfigure the daemon.':
      'Changes apply immediately in this browser. They do not restart or reconfigure the daemon.',
    'Browser preferences, not daemon administration.':
      'Browser preferences, not daemon administration.',
    Downloads: 'Downloads',
    'Your browser chooses where exported files and downloaded artifacts are saved. Use its download settings to change the default folder or ask where to save each file. The workstation cannot set a local filesystem folder.':
      'Your browser chooses where exported files and downloaded artifacts are saved. Use its download settings to change the default folder or ask where to save each file. The workstation cannot set a local filesystem folder.',
    'About WaveDL': 'About WaveDL',
    'Client build {buildId}': 'Client build {buildId}',
    'Wave-based deep-learning experiments, planned and executed by your daemon.':
      'Wave-based deep-learning experiments, planned and executed by your daemon.',
    'Project and feedback': 'Project and feedback',
    'Do not include access tokens, private paths or training data in public feedback. Reloads are always user initiated.':
      'Do not include access tokens, private paths or training data in public feedback. Reloads are always user initiated.',
    'New-run defaults': 'New-run defaults',
    'Saved separately for each verified daemon identity, in this browser only. Dataset, model, runtime, credentials and executable-code selections are never saved here. Existing drafts, approved plans and submitted runs are unchanged.':
      'Saved separately for each verified daemon identity, in this browser only. Dataset, model, runtime, credentials and executable-code selections are never saved here. Existing drafts, approved plans and submitted runs are unchanged.',
    'Connect to a daemon to configure its training defaults.':
      'Connect to a daemon to configure its training defaults.',
    'Training and optional W&B defaults': 'Training and optional W&B defaults',
    'W&B remains optional. Its credentials and project selection belong to the daemon host or the explicit run draft. No previous run cache is deleted.':
      'W&B remains optional. Its credentials and project selection belong to the daemon host or the explicit run draft. No previous run cache is deleted.',
    'Save training defaults': 'Save training defaults',
    'Reset training defaults': 'Reset training defaults',
    'Defaults saved for new drafts on this daemon.':
      'Defaults saved for new drafts on this daemon.',
    'Defaults could not be saved. Browser storage may be unavailable or full.':
      'Defaults could not be saved. Browser storage may be unavailable or full.',
    'Training defaults reset. Existing drafts and runs are unchanged.':
      'Training defaults reset. Existing drafts and runs are unchanged.',
    'Defaults could not be reset.': 'Defaults could not be reset.',
    'Enter the daemon bearer credential.': 'Enter the daemon bearer credential.',
    'The credential is too long.': 'The credential is too long.',
    'Enter a valid bearer credential.': 'Enter a valid bearer credential.',
    'Reconnect explicitly to verify the daemon again.':
      'Reconnect explicitly to verify the daemon again.',
    'Offline: live status and actions are unavailable.':
      'Offline: live status and actions are unavailable.',
    'Credential expired or rejected; enter it again.':
      'Credential expired or rejected; enter it again.',
    'Daemon identity, build or protocol changed. Update the client or explicitly disconnect before changing daemon scope.':
      'Daemon identity, build or protocol changed. Update the client or explicitly disconnect before changing daemon scope.',
    'The daemon returned an invalid response. Reconnect to verify its identity.':
      'The daemon returned an invalid response. Reconnect to verify its identity.',
    'The daemon request failed. Verify connectivity and the operation outcome before retrying.':
      'The daemon request failed. Verify connectivity and the operation outcome before retrying.',
  },
  {
    'Skip to workspace': 'Chuyển đến không gian làm việc',
    'Workstation navigation': 'Điều hướng trạm làm việc',
    WORKSPACE: 'KHÔNG GIAN LÀM VIỆC',
    Sections: 'Các mục',
    Experiments: 'Thí nghiệm',
    'New training run': 'Lượt huấn luyện mới',
    Datasets: 'Tập dữ liệu',
    Results: 'Kết quả',
    'Adopt standalone run': 'Tiếp nhận lượt chạy độc lập',
    Connection: 'Kết nối',
    Settings: 'Cài đặt',
    'Your compute. Your workspace.': 'Tài nguyên của bạn. Không gian của bạn.',
    'Execution belongs to the daemon.': 'Daemon chịu trách nhiệm thực thi.',
    'Local-first computation': 'Tính toán ưu tiên cục bộ',
    Workstation: 'Trạm làm việc',
    Connected: 'Đã kết nối',
    Connecting: 'Đang kết nối',
    Offline: 'Ngoại tuyến',
    'Not connected': 'Chưa kết nối',
    'WaveDL daemon interface · Development foundation':
      'Giao diện daemon WaveDL · Nền tảng phát triển',
    'YOUR COMPUTE. YOUR WORKSPACE.': 'TÀI NGUYÊN CỦA BẠN. KHÔNG GIAN CỦA BẠN.',
    'Connect to your daemon.': 'Kết nối với daemon của bạn.',
    'Your daemon runs the experiments. This browser connects only to its current origin; credentials stay in memory.':
      'Daemon của bạn chạy các thí nghiệm. Trình duyệt này chỉ kết nối với nguồn hiện tại; thông tin xác thực chỉ lưu trong bộ nhớ.',
    'Connection identity changed': 'Danh tính kết nối đã thay đổi',
    'Connection status': 'Trạng thái kết nối',
    'A newer WaveDL build is available': 'Đã có bản dựng WaveDL mới hơn',
    Reload: 'Tải lại',
    'Connected to {daemonId} · build {buildId}': 'Đã kết nối với {daemonId} · bản dựng {buildId}',
    'Verify connection': 'Xác minh kết nối',
    Disconnect: 'Ngắt kết nối',
    'Daemon bearer credential': 'Thông tin xác thực bearer của daemon',
    'Paste the credential provided by WaveDL. It is not saved to browser storage.':
      'Dán thông tin xác thực do WaveDL cung cấp. Thông tin này không được lưu vào bộ nhớ trình duyệt.',
    'Connecting…': 'Đang kết nối…',
    'Connect securely': 'Kết nối an toàn',
    'Disconnect and clear scope': 'Ngắt kết nối và xóa phạm vi',
    'Disconnecting never cancels running jobs. An offline page cannot confirm live status or perform actions. A changed daemon identity requires an explicit disconnect before starting a new scope.':
      'Ngắt kết nối không hủy các tác vụ đang chạy. Trang ngoại tuyến không thể xác nhận trạng thái trực tiếp hoặc thực hiện thao tác. Khi danh tính daemon thay đổi, bạn phải chủ động ngắt kết nối trước khi bắt đầu phạm vi mới.',
    'Appearance and guidance': 'Giao diện và hướng dẫn',
    Appearance: 'Giao diện',
    System: 'Hệ thống',
    Light: 'Sáng',
    Dark: 'Tối',
    Accent: 'Màu nhấn',
    Neutral: 'Trung tính',
    Blue: 'Xanh dương',
    Violet: 'Tím',
    Green: 'Xanh lá',
    'Interface scale': 'Tỷ lệ giao diện',
    Language: 'Ngôn ngữ',
    'Choose the language used throughout this workstation.':
      'Chọn ngôn ngữ dùng trong toàn bộ trạm làm việc.',
    'Show the new-project guide': 'Hiện hướng dẫn dự án mới',
    'Save appearance': 'Lưu giao diện',
    'Discard changes': 'Bỏ thay đổi',
    'Browser preferences saved.': 'Đã lưu tùy chọn trình duyệt.',
    'Applied for this session. Browser storage is unavailable.':
      'Đã áp dụng cho phiên này. Không thể sử dụng bộ nhớ trình duyệt.',
    'Changes apply immediately in this browser. They do not restart or reconfigure the daemon.':
      'Thay đổi được áp dụng ngay trong trình duyệt này. Chúng không khởi động lại hoặc cấu hình lại daemon.',
    'Browser preferences, not daemon administration.':
      'Tùy chọn trình duyệt, không phải quản trị daemon.',
    Downloads: 'Tải xuống',
    'Your browser chooses where exported files and downloaded artifacts are saved. Use its download settings to change the default folder or ask where to save each file. The workstation cannot set a local filesystem folder.':
      'Trình duyệt quyết định nơi lưu tệp xuất và sản phẩm tải xuống. Dùng cài đặt tải xuống của trình duyệt để đổi thư mục mặc định hoặc hỏi nơi lưu từng tệp. Trạm làm việc không thể đặt thư mục trên hệ thống tệp cục bộ.',
    'About WaveDL': 'Giới thiệu WaveDL',
    'Client build {buildId}': 'Bản dựng ứng dụng {buildId}',
    'Wave-based deep-learning experiments, planned and executed by your daemon.':
      'Thí nghiệm học sâu dựa trên sóng, được daemon của bạn lập kế hoạch và thực thi.',
    'Project and feedback': 'Dự án và phản hồi',
    'Do not include access tokens, private paths or training data in public feedback. Reloads are always user initiated.':
      'Không đưa mã truy cập, đường dẫn riêng tư hoặc dữ liệu huấn luyện vào phản hồi công khai. Việc tải lại luôn do bạn chủ động thực hiện.',
    'New-run defaults': 'Mặc định cho lượt chạy mới',
    'Saved separately for each verified daemon identity, in this browser only. Dataset, model, runtime, credentials and executable-code selections are never saved here. Existing drafts, approved plans and submitted runs are unchanged.':
      'Lưu riêng cho từng danh tính daemon đã xác minh, chỉ trong trình duyệt này. Các lựa chọn tập dữ liệu, mô hình, môi trường chạy, thông tin xác thực và mã thực thi không được lưu ở đây. Bản nháp hiện có, kế hoạch đã duyệt và lượt chạy đã gửi không thay đổi.',
    'Connect to a daemon to configure its training defaults.':
      'Kết nối với daemon để cấu hình mặc định huấn luyện.',
    'Training and optional W&B defaults': 'Mặc định huấn luyện và W&B tùy chọn',
    'W&B remains optional. Its credentials and project selection belong to the daemon host or the explicit run draft. No previous run cache is deleted.':
      'W&B vẫn là tùy chọn. Thông tin xác thực và lựa chọn dự án thuộc máy chủ daemon hoặc bản nháp lượt chạy cụ thể. Không xóa bộ nhớ đệm của lượt chạy trước.',
    'Save training defaults': 'Lưu mặc định huấn luyện',
    'Reset training defaults': 'Đặt lại mặc định huấn luyện',
    'Defaults saved for new drafts on this daemon.':
      'Đã lưu mặc định cho bản nháp mới trên daemon này.',
    'Defaults could not be saved. Browser storage may be unavailable or full.':
      'Không thể lưu mặc định. Bộ nhớ trình duyệt có thể không khả dụng hoặc đã đầy.',
    'Training defaults reset. Existing drafts and runs are unchanged.':
      'Đã đặt lại mặc định huấn luyện. Bản nháp và lượt chạy hiện có không thay đổi.',
    'Defaults could not be reset.': 'Không thể đặt lại mặc định.',
    'Enter the daemon bearer credential.': 'Nhập thông tin xác thực bearer của daemon.',
    'The credential is too long.': 'Thông tin xác thực quá dài.',
    'Enter a valid bearer credential.': 'Nhập thông tin xác thực bearer hợp lệ.',
    'Reconnect explicitly to verify the daemon again.':
      'Chủ động kết nối lại để xác minh daemon lần nữa.',
    'Offline: live status and actions are unavailable.':
      'Ngoại tuyến: không có trạng thái trực tiếp và thao tác.',
    'Credential expired or rejected; enter it again.':
      'Thông tin xác thực đã hết hạn hoặc bị từ chối; hãy nhập lại.',
    'Daemon identity, build or protocol changed. Update the client or explicitly disconnect before changing daemon scope.':
      'Danh tính, bản dựng hoặc giao thức daemon đã thay đổi. Cập nhật ứng dụng hoặc chủ động ngắt kết nối trước khi đổi phạm vi daemon.',
    'The daemon returned an invalid response. Reconnect to verify its identity.':
      'Daemon trả về phản hồi không hợp lệ. Kết nối lại để xác minh danh tính.',
    'The daemon request failed. Verify connectivity and the operation outcome before retrying.':
      'Yêu cầu tới daemon thất bại. Xác minh kết nối và kết quả thao tác trước khi thử lại.',
  },
);
