import { defineMessages } from './core';

/** Presentation only: identifiers, draft values and exported artifacts stay unchanged. */
export const projectMessages = defineMessages(
  {
    Training: 'Training',
    'Optimizer, loss and scheduling': 'Optimizer, loss and scheduling',
    'Data, checkpoints and cross-validation': 'Data, checkpoints and cross-validation',
    'Custom models and physical constraints': 'Custom models and physical constraints',
    'Optional experiment logging': 'Optional experiment logging',
    'Resume and constraint-file paths belong to the daemon host. Import modules and constraint code run in your selected Python environment. W&B credentials are configured on that host, never stored in this form. Each run uses an isolated cache; this page never deletes previous run data.':
      'Resume and constraint-file paths belong to the daemon host. Import modules and constraint code run in your selected Python environment. W&B credentials are configured on that host, never stored in this form. Each run uses an isolated cache; this page never deletes previous run data.',
    ' Enter one value per line.': ' Enter one value per line.',
    'Training presets': 'Training presets',
    'Presets update this same draft. Dataset, model and execution settings stay selected; any plan approval is invalidated. Timings and accuracy depend on your data and hardware.':
      'Presets update this same draft. Dataset, model and execution settings stay selected; any plan approval is invalidated. Timings and accuracy depend on your data and hardware.',
    Preset: 'Preset',
    'Apply preset to draft': 'Apply preset to draft',
    'Import JSON training preset': 'Import JSON training preset',
    'Configuration only, 64 KiB maximum. This is not a dataset upload; the selected daemon dataset stays unchanged. Runtime environment and credentials cannot be imported. YAML export is supported separately.':
      'Configuration only, 64 KiB maximum. This is not a dataset upload; the selected daemon dataset stays unchanged. Runtime environment and credentials cannot be imported. YAML export is supported separately.',
    'Preset exceeds the 64 KiB limit.': 'Preset exceeds the 64 KiB limit.',
    'Validated preset applied to the draft. Review it before planning.':
      'Validated preset applied to the draft. Review it before planning.',
    'Invalid preset. Use a JSON object containing only typed training fields, without dataset, model, runtime or output paths.':
      'Invalid preset. Use a JSON object containing only typed training fields, without dataset, model, runtime or output paths.',
    'Fast iteration': 'Fast iteration',
    'Shorter exploratory training, not a duration guarantee.':
      'Shorter exploratory training, not a duration guarantee.',
    Balanced: 'Balanced',
    'Moderate epoch budget and early stopping.': 'Moderate epoch budget and early stopping.',
    'Longer training': 'Longer training',
    'More epochs and patience; improved accuracy is not guaranteed.':
      'More epochs and patience; improved accuracy is not guaranteed.',
    'Standalone configuration export': 'Standalone configuration export',
    'These exports reflect your validated draft, never an approved daemon plan. Run the POSIX command on the selected Python host with the same dataset paths. Output goes to ./results there. This does not submit Slurm work, reproduce scheduler policy, or configure credentials.':
      'These exports reflect your validated draft, never an approved daemon plan. Run the POSIX command on the selected Python host with the same dataset paths. Output goes to ./results there. This does not submit Slurm work, reproduce scheduler policy, or configure credentials.',
    'Download YAML': 'Download YAML',
    'Copy standalone CLI command': 'Copy standalone CLI command',
    'Validated training YAML export requested. Your browser controls where it is saved; runtime environment and credentials omitted.':
      'Validated training YAML export requested. Your browser controls where it is saved; runtime environment and credentials omitted.',
    'Validate all training and execution fields before exporting.':
      'Validate all training and execution fields before exporting.',
    'YAML export could not be requested. Check your browser download settings and retry.':
      'YAML export could not be requested. Check your browser download settings and retry.',
    'Standalone POSIX command copied.': 'Standalone POSIX command copied.',
    'Clipboard unavailable; select the displayed command manually.':
      'Clipboard unavailable; select the displayed command manually.',
    'This exporter quotes POSIX shell commands only. Windows host commands require a Windows-specific exporter; use the YAML configuration.':
      'This exporter quotes POSIX shell commands only. Windows host commands require a Windows-specific exporter; use the YAML configuration.',
    'Multi-node standalone commands require explicit rendezvous and are not exported by this editor.':
      'Multi-node standalone commands require explicit rendezvous and are not exported by this editor.',
    'Choose explicit CPU or CUDA for a reproducible standalone command.':
      'Choose explicit CPU or CUDA for a reproducible standalone command.',
    'Container startup is operator-owned; a standalone host command cannot reproduce it.':
      'Container startup is operator-owned; a standalone host command cannot reproduce it.',
    'Explicit environment values are not exported because they may contain secrets. Configure them safely on the host, or clear them before exporting a command.':
      'Explicit environment values are not exported because they may contain secrets. Configure them safely on the host, or clear them before exporting a command.',
    'Incomplete training schema.': 'Incomplete training schema.',
    'Standalone CLI list entries cannot start with an option prefix; use the YAML export.':
      'Standalone CLI list entries cannot start with an option prefix; use the YAML export.',
    'Persisted plan for approval': 'Persisted plan for approval',
    "This is the daemon's immutable normalized configuration, manifest, paths, command and warnings—not a prediction from your draft. Read it before starting. Submission sends only this exact plan ID.":
      "This is the daemon's immutable normalized configuration, manifest, paths, command and warnings—not a prediction from your draft. Read it before starting. Submission sends only this exact plan ID.",
    'Approved normalized manifest': 'Approved normalized manifest',
    'Full persisted execution plan': 'Full persisted execution plan',
    'Persisted execution plan': 'Persisted execution plan',
    'Submission acknowledged': 'Submission acknowledged',
    'Approve and start this plan': 'Approve and start this plan',
    'Check submission status': 'Check submission status',
    'If acknowledgment is lost, check status or retry this same approved plan. Leaving this page stops browser waiting, never cancels server work.':
      'If acknowledgment is lost, check status or retry this same approved plan. Leaving this page stops browser waiting, never cancels server work.',
    'Run {run} · request {request} · plan {plan}': 'Run {run} · request {request} · plan {plan}',
    Dataset: 'Dataset',
    Model: 'Model',
    'Training & runtime': 'Training & runtime',
    'Review & approval': 'Review & approval',
    Acknowledged: 'Acknowledged',
    'Guided training authoring': 'Guided training authoring',
    'Show full editor': 'Show full editor',
    'Use guided steps': 'Use guided steps',
    "Guided steps share the ordinary editor's draft and validation. Advancing never plans or starts a run.":
      "Guided steps share the ordinary editor's draft and validation. Advancing never plans or starts a run.",
    'Previous step': 'Previous step',
    'Next step': 'Next step',
    'Python interpreter': 'Python interpreter',
    'Absolute interpreter path selected for the execution host. Explicit storage mappings rewrite host-side paths once; browser Python and browser file paths are not used.':
      'Absolute interpreter path selected for the execution host. Explicit storage mappings rewrite host-side paths once; browser Python and browser file paths are not used.',
    'Configured backend': 'Configured backend',
    'Runtime mode': 'Runtime mode',
    Device: 'Device',
    Machines: 'Machines',
    'Processes per machine': 'Processes per machine',
    'Machine rank': 'Machine rank',
    'Execution environment': 'Execution environment',
    'Device, precision and topology are validated during daemon planning. Bundled/container modes and explicit MPS training are not implemented by current backends; planning refuses them. Slurm account, partition, resources, environment setup and storage mappings remain configured operator policy, not invented browser defaults.':
      'Device, precision and topology are validated during daemon planning. Bundled/container modes and explicit MPS training are not implemented by current backends; planning refuses them. Slurm account, partition, resources, environment setup and storage mappings remain configured operator policy, not invented browser defaults.',
    local: 'local',
    existing: 'existing',
    selected: 'selected',
    bundled: 'bundled',
    container: 'container',
    auto: 'auto',
    'Explicit runtime environment': 'Explicit runtime environment',
    'These values are in the persisted execution plan. Do not enter credentials here; configure secrets on the daemon host.':
      'These values are in the persisted execution plan. Do not enter credentials here; configure secrets on the daemon host.',
    'Use a unique environment name; scheduler and launcher identity are daemon-owned.':
      'Use a unique environment name; scheduler and launcher identity are daemon-owned.',
    'Remove {name}': 'Remove {name}',
    'New environment variable': 'New environment variable',
    'Add variable': 'Add variable',
    'Use a custom registered model': 'Use a custom registered model',
    'Custom model registry ID': 'Custom model registry ID',
    'This explicit ID is unverified—not a catalogue entry. Configure import modules in advanced training options and ensure they register this ID in your selected Python environment. Only execution can establish compatibility.':
      'This explicit ID is unverified—not a catalogue entry. Configure import modules in advanced training options and ensure they register this ID in your selected Python environment. Only execution can establish compatibility.',
    'Use custom model identifier': 'Use custom model identifier',
    'Custom identifier could not be selected. Verify the daemon connection and retry.':
      'Custom identifier could not be selected. Verify the daemon connection and retry.',
    'Build a training run': 'Build a training run',
    'Author a draft, review a persisted daemon plan, then explicitly approve it. Nothing starts automatically.':
      'Author a draft, review a persisted daemon plan, then explicitly approve it. Nothing starts automatically.',
    'Verified connection required': 'Verified connection required',
    'Connect to the daemon before choosing files, planning or submitting.':
      'Connect to the daemon before choosing files, planning or submitting.',
    'Planning status': 'Planning status',
    'Choose daemon dataset': 'Choose daemon dataset',
    'Training dataset': 'Training dataset',
    'Not selected': 'Not selected',
    'Dataset: {path}{daemon}. Browser files are not uploaded.':
      'Dataset: {path}{daemon}. Browser files are not uploaded.',
    ' · daemon {id}': ' · daemon {id}',
    'Choose model': 'Choose model',
    'Model: {model}{custom}. Catalogue descriptions do not certify runtime compatibility.':
      'Model: {model}{custom}. Catalogue descriptions do not certify runtime compatibility.',
    ' · custom, unverified': ' · custom, unverified',
    'Waiting for daemon…': 'Waiting for daemon…',
    'Preview persisted plan': 'Preview persisted plan',
    'Reset training defaults': 'Reset training defaults',
    'Stop waiting': 'Stop waiting',
    'Confirm reset': 'Confirm reset',
    'Reset training options? Your dataset, model and execution environment remain selected. This invalidates the preview, never changes an existing run.':
      'Reset training options? Your dataset, model and execution environment remain selected. This invalidates the preview, never changes an existing run.',
    'Keep draft': 'Keep draft',
    'Acknowledged training run': 'Acknowledged training run',
    'Daemon acknowledged the run': 'Daemon acknowledged the run',
    '{run} · {state}. This acknowledgment is not proof of training completion; open the run monitor for current evidence.':
      '{run} · {state}. This acknowledgment is not proof of training completion; open the run monitor for current evidence.',
    'Open acknowledged run': 'Open acknowledged run',
    'Choose a dataset from the current daemon.': 'Choose a dataset from the current daemon.',
    'Choose a catalogue model or explicit custom identifier.':
      'Choose a catalogue model or explicit custom identifier.',
    'Review training and runtime validation errors before approval.':
      'Review training and runtime validation errors before approval.',
    'The request was not acknowledged; server work may already exist. Reconnect if needed, then retry preview with this unchanged draft, or check/retry the approved submission. Never create a replacement draft merely to retry.':
      'The request was not acknowledged; server work may already exist. Reconnect if needed, then retry preview with this unchanged draft, or check/retry the approved submission. Never create a replacement draft merely to retry.',
    'The daemon refused this plan. Correct the settings and preview again.':
      'The daemon refused this plan. Correct the settings and preview again.',
    'Choose a dataset and model from this daemon first.':
      'Choose a dataset and model from this daemon first.',
    'Selection or configuration is stale. Select again from the verified daemon.':
      'Selection or configuration is stale. Select again from the verified daemon.',
    'Review the validation errors before requesting a plan.':
      'Review the validation errors before requesting a plan.',
    'Daemon acknowledged this exact plan.': 'Daemon acknowledged this exact plan.',
    'Daemon reports {state}{submission}.': 'Daemon reports {state}{submission}.',
    '; submission requested': '; submission requested',
    '; not submitted yet': '; not submitted yet',
  },
  {
    Training: 'Huấn luyện',
    'Optimizer, loss and scheduling': 'Bộ tối ưu, hàm mất mát và lịch học',
    'Data, checkpoints and cross-validation': 'Dữ liệu, checkpoint và kiểm định chéo',
    'Custom models and physical constraints': 'Mô hình tùy chỉnh và ràng buộc vật lý',
    'Optional experiment logging': 'Ghi nhật ký thí nghiệm (tùy chọn)',
    'Resume and constraint-file paths belong to the daemon host. Import modules and constraint code run in your selected Python environment. W&B credentials are configured on that host, never stored in this form. Each run uses an isolated cache; this page never deletes previous run data.':
      'Đường dẫn khôi phục và tệp ràng buộc nằm trên máy chủ daemon. Mô-đun nhập và mã ràng buộc chạy trong môi trường Python đã chọn. Thông tin đăng nhập W&B được cấu hình trên máy chủ đó, không lưu trong biểu mẫu này. Mỗi lần chạy dùng bộ nhớ đệm riêng; trang này không bao giờ xóa dữ liệu lần chạy trước.',
    ' Enter one value per line.': ' Nhập mỗi giá trị trên một dòng.',
    'Training presets': 'Cấu hình huấn luyện mẫu',
    'Presets update this same draft. Dataset, model and execution settings stay selected; any plan approval is invalidated. Timings and accuracy depend on your data and hardware.':
      'Cấu hình mẫu cập nhật bản nháp hiện tại. Bộ dữ liệu, mô hình và thiết lập thực thi vẫn giữ nguyên; mọi phê duyệt kế hoạch sẽ mất hiệu lực. Thời gian và độ chính xác phụ thuộc vào dữ liệu và phần cứng.',
    Preset: 'Cấu hình mẫu',
    'Apply preset to draft': 'Áp dụng cấu hình mẫu vào bản nháp',
    'Import JSON training preset': 'Nhập cấu hình huấn luyện mẫu JSON',
    'Configuration only, 64 KiB maximum. This is not a dataset upload; the selected daemon dataset stays unchanged. Runtime environment and credentials cannot be imported. YAML export is supported separately.':
      'Chỉ nhập cấu hình, tối đa 64 KiB. Đây không phải tải bộ dữ liệu lên; bộ dữ liệu daemon đã chọn không đổi. Không thể nhập môi trường thực thi hay thông tin đăng nhập. Xuất YAML được hỗ trợ riêng.',
    'Preset exceeds the 64 KiB limit.': 'Cấu hình mẫu vượt giới hạn 64 KiB.',
    'Validated preset applied to the draft. Review it before planning.':
      'Cấu hình mẫu hợp lệ đã được áp dụng vào bản nháp. Hãy xem lại trước khi lập kế hoạch.',
    'Invalid preset. Use a JSON object containing only typed training fields, without dataset, model, runtime or output paths.':
      'Cấu hình mẫu không hợp lệ. Dùng đối tượng JSON chỉ chứa các trường huấn luyện đúng kiểu, không chứa bộ dữ liệu, mô hình, môi trường thực thi hay đường dẫn đầu ra.',
    'Fast iteration': 'Thử nghiệm nhanh',
    'Shorter exploratory training, not a duration guarantee.':
      'Huấn luyện thăm dò ngắn hơn, không bảo đảm thời lượng.',
    Balanced: 'Cân bằng',
    'Moderate epoch budget and early stopping.': 'Số epoch vừa phải và dừng sớm.',
    'Longer training': 'Huấn luyện dài hơn',
    'More epochs and patience; improved accuracy is not guaranteed.':
      'Nhiều epoch và ngưỡng chờ hơn; không bảo đảm tăng độ chính xác.',
    'Standalone configuration export': 'Xuất cấu hình độc lập',
    'These exports reflect your validated draft, never an approved daemon plan. Run the POSIX command on the selected Python host with the same dataset paths. Output goes to ./results there. This does not submit Slurm work, reproduce scheduler policy, or configure credentials.':
      'Các bản xuất phản ánh bản nháp đã kiểm tra hợp lệ, không phải kế hoạch daemon đã phê duyệt. Chạy lệnh POSIX trên máy chủ Python đã chọn với cùng đường dẫn bộ dữ liệu. Kết quả được lưu tại ./results trên máy đó. Thao tác này không gửi tác vụ Slurm, tái tạo chính sách lập lịch hay cấu hình thông tin đăng nhập.',
    'Download YAML': 'Tải YAML',
    'Copy standalone CLI command': 'Sao chép lệnh CLI độc lập',
    'Validated training YAML export requested. Your browser controls where it is saved; runtime environment and credentials omitted.':
      'Đã yêu cầu xuất YAML huấn luyện hợp lệ. Trình duyệt quyết định nơi lưu; môi trường thực thi và thông tin đăng nhập được loại bỏ.',
    'Validate all training and execution fields before exporting.':
      'Kiểm tra tính hợp lệ của mọi trường huấn luyện và thực thi trước khi xuất.',
    'YAML export could not be requested. Check your browser download settings and retry.':
      'Không thể yêu cầu xuất YAML. Hãy kiểm tra cài đặt tải xuống của trình duyệt rồi thử lại.',
    'Standalone POSIX command copied.': 'Đã sao chép lệnh POSIX độc lập.',
    'Clipboard unavailable; select the displayed command manually.':
      'Không thể dùng bảng nhớ tạm; hãy chọn lệnh hiển thị để sao chép thủ công.',
    'This exporter quotes POSIX shell commands only. Windows host commands require a Windows-specific exporter; use the YAML configuration.':
      'Bộ xuất này chỉ hỗ trợ trích dẫn lệnh shell POSIX. Lệnh trên máy Windows cần bộ xuất riêng cho Windows; hãy dùng cấu hình YAML.',
    'Multi-node standalone commands require explicit rendezvous and are not exported by this editor.':
      'Lệnh độc lập đa nút cần cấu hình điểm kết nối rendezvous rõ ràng và không được trình soạn thảo này xuất.',
    'Choose explicit CPU or CUDA for a reproducible standalone command.':
      'Chọn rõ CPU hoặc CUDA để tạo lệnh độc lập có thể tái lập.',
    'Container startup is operator-owned; a standalone host command cannot reproduce it.':
      'Khởi động container do người vận hành quản lý; lệnh máy chủ độc lập không thể tái tạo.',
    'Explicit environment values are not exported because they may contain secrets. Configure them safely on the host, or clear them before exporting a command.':
      'Không xuất các giá trị môi trường vì chúng có thể chứa bí mật. Hãy cấu hình an toàn trên máy chủ hoặc xóa chúng trước khi xuất lệnh.',
    'Incomplete training schema.': 'Lược đồ huấn luyện chưa đầy đủ.',
    'Standalone CLI list entries cannot start with an option prefix; use the YAML export.':
      'Phần tử danh sách CLI độc lập không được bắt đầu bằng tiền tố tùy chọn; hãy xuất YAML.',
    'Persisted plan for approval': 'Kế hoạch đã lưu để phê duyệt',
    "This is the daemon's immutable normalized configuration, manifest, paths, command and warnings—not a prediction from your draft. Read it before starting. Submission sends only this exact plan ID.":
      'Đây là cấu hình chuẩn hóa, manifest, đường dẫn, lệnh và cảnh báo bất biến của daemon — không phải dự đoán từ bản nháp. Hãy đọc trước khi bắt đầu. Khi gửi, chỉ ID chính xác của kế hoạch này được gửi đi.',
    'Approved normalized manifest': 'Manifest chuẩn hóa đã phê duyệt',
    'Full persisted execution plan': 'Toàn bộ kế hoạch thực thi đã lưu',
    'Persisted execution plan': 'Kế hoạch thực thi đã lưu',
    'Submission acknowledged': 'Đã xác nhận tiếp nhận',
    'Approve and start this plan': 'Phê duyệt và bắt đầu kế hoạch này',
    'Check submission status': 'Kiểm tra trạng thái gửi',
    'If acknowledgment is lost, check status or retry this same approved plan. Leaving this page stops browser waiting, never cancels server work.':
      'Nếu mất xác nhận, hãy kiểm tra trạng thái hoặc gửi lại cùng kế hoạch đã phê duyệt này. Rời trang chỉ dừng chờ trong trình duyệt, không hủy công việc trên máy chủ.',
    'Run {run} · request {request} · plan {plan}':
      'Lần chạy {run} · yêu cầu {request} · kế hoạch {plan}',
    Dataset: 'Bộ dữ liệu',
    Model: 'Mô hình',
    'Training & runtime': 'Huấn luyện và môi trường thực thi',
    'Review & approval': 'Xem lại và phê duyệt',
    Acknowledged: 'Đã tiếp nhận',
    'Guided training authoring': 'Soạn cấu hình huấn luyện có hướng dẫn',
    'Show full editor': 'Hiện trình soạn thảo đầy đủ',
    'Use guided steps': 'Dùng các bước hướng dẫn',
    "Guided steps share the ordinary editor's draft and validation. Advancing never plans or starts a run.":
      'Các bước hướng dẫn dùng chung bản nháp và kiểm tra hợp lệ với trình soạn thảo thông thường. Chuyển bước không lập kế hoạch hay bắt đầu lần chạy.',
    'Previous step': 'Bước trước',
    'Next step': 'Bước tiếp theo',
    'Python interpreter': 'Trình thông dịch Python',
    'Absolute interpreter path selected for the execution host. Explicit storage mappings rewrite host-side paths once; browser Python and browser file paths are not used.':
      'Đường dẫn trình thông dịch tuyệt đối được chọn cho máy thực thi. Ánh xạ lưu trữ tường minh chỉ viết lại đường dẫn phía máy chủ một lần; không dùng Python hay đường dẫn tệp của trình duyệt.',
    'Configured backend': 'Backend đã cấu hình',
    'Runtime mode': 'Chế độ thực thi',
    Device: 'Thiết bị',
    Machines: 'Số máy',
    'Processes per machine': 'Số tiến trình mỗi máy',
    'Machine rank': 'Thứ hạng máy',
    'Execution environment': 'Môi trường thực thi',
    'Device, precision and topology are validated during daemon planning. Bundled/container modes and explicit MPS training are not implemented by current backends; planning refuses them. Slurm account, partition, resources, environment setup and storage mappings remain configured operator policy, not invented browser defaults.':
      'Thiết bị, độ chính xác và cấu trúc triển khai được kiểm tra khi daemon lập kế hoạch. Backend hiện tại chưa triển khai chế độ bundled/container hay huấn luyện MPS rõ ràng; yêu cầu lập kế hoạch sẽ bị từ chối. Tài khoản Slurm, phân vùng, tài nguyên, thiết lập môi trường và ánh xạ lưu trữ vẫn là chính sách do người vận hành cấu hình, không phải giá trị mặc định do trình duyệt tự đặt.',
    local: 'Cục bộ (local)',
    existing: 'Hiện có (existing)',
    selected: 'Đã chọn (selected)',
    bundled: 'Đóng gói sẵn (bundled)',
    container: 'Container (container)',
    auto: 'Tự động (auto)',
    'Explicit runtime environment': 'Biến môi trường thực thi rõ ràng',
    'These values are in the persisted execution plan. Do not enter credentials here; configure secrets on the daemon host.':
      'Các giá trị này nằm trong kế hoạch thực thi đã lưu. Không nhập thông tin đăng nhập tại đây; hãy cấu hình bí mật trên máy chủ daemon.',
    'Use a unique environment name; scheduler and launcher identity are daemon-owned.':
      'Dùng tên biến môi trường duy nhất; định danh bộ lập lịch và trình khởi chạy do daemon quản lý.',
    'Remove {name}': 'Xóa {name}',
    'New environment variable': 'Biến môi trường mới',
    'Add variable': 'Thêm biến',
    'Use a custom registered model': 'Dùng mô hình đăng ký tùy chỉnh',
    'Custom model registry ID': 'ID mô hình tùy chỉnh trong registry',
    'This explicit ID is unverified—not a catalogue entry. Configure import modules in advanced training options and ensure they register this ID in your selected Python environment. Only execution can establish compatibility.':
      'ID chỉ định này chưa được xác minh — không phải mục trong danh mục. Cấu hình mô-đun nhập trong tùy chọn huấn luyện nâng cao và bảo đảm chúng đăng ký ID này trong môi trường Python đã chọn. Chỉ thực thi mới xác định được tính tương thích.',
    'Use custom model identifier': 'Dùng định danh mô hình tùy chỉnh',
    'Custom identifier could not be selected. Verify the daemon connection and retry.':
      'Không thể chọn định danh tùy chỉnh. Kiểm tra kết nối daemon rồi thử lại.',
    'Build a training run': 'Tạo một lần huấn luyện',
    'Author a draft, review a persisted daemon plan, then explicitly approve it. Nothing starts automatically.':
      'Soạn bản nháp, xem lại kế hoạch daemon đã lưu, rồi chủ động phê duyệt. Không có tác vụ nào tự động bắt đầu.',
    'Verified connection required': 'Cần kết nối đã xác minh',
    'Connect to the daemon before choosing files, planning or submitting.':
      'Kết nối daemon trước khi chọn tệp, lập kế hoạch hoặc gửi.',
    'Planning status': 'Trạng thái lập kế hoạch',
    'Choose daemon dataset': 'Chọn bộ dữ liệu trên daemon',
    'Training dataset': 'Bộ dữ liệu huấn luyện',
    'Not selected': 'Chưa chọn',
    'Dataset: {path}{daemon}. Browser files are not uploaded.':
      'Bộ dữ liệu: {path}{daemon}. Tệp trình duyệt không được tải lên.',
    ' · daemon {id}': ' · daemon {id}',
    'Choose model': 'Chọn mô hình',
    'Model: {model}{custom}. Catalogue descriptions do not certify runtime compatibility.':
      'Mô hình: {model}{custom}. Mô tả danh mục không chứng nhận tính tương thích khi thực thi.',
    ' · custom, unverified': ' · tùy chỉnh, chưa xác minh',
    'Waiting for daemon…': 'Đang chờ daemon…',
    'Preview persisted plan': 'Xem trước kế hoạch đã lưu',
    'Reset training defaults': 'Đặt lại mặc định huấn luyện',
    'Stop waiting': 'Dừng chờ',
    'Confirm reset': 'Xác nhận đặt lại',
    'Reset training options? Your dataset, model and execution environment remain selected. This invalidates the preview, never changes an existing run.':
      'Đặt lại tùy chọn huấn luyện? Bộ dữ liệu, mô hình và môi trường thực thi đã chọn được giữ nguyên. Thao tác này làm mất hiệu lực bản xem trước, không thay đổi lần chạy hiện có.',
    'Keep draft': 'Giữ bản nháp',
    'Acknowledged training run': 'Lần huấn luyện đã được tiếp nhận',
    'Daemon acknowledged the run': 'Daemon đã tiếp nhận lần chạy',
    '{run} · {state}. This acknowledgment is not proof of training completion; open the run monitor for current evidence.':
      '{run} · {state}. Xác nhận này không chứng minh huấn luyện đã hoàn tất; hãy mở màn hình theo dõi lần chạy để xem bằng chứng hiện tại.',
    'Open acknowledged run': 'Mở lần chạy đã tiếp nhận',
    'Choose a dataset from the current daemon.': 'Chọn bộ dữ liệu từ daemon hiện tại.',
    'Choose a catalogue model or explicit custom identifier.':
      'Chọn mô hình trong danh mục hoặc định danh tùy chỉnh rõ ràng.',
    'Review training and runtime validation errors before approval.':
      'Xem lại lỗi kiểm tra huấn luyện và môi trường thực thi trước khi phê duyệt.',
    'The request was not acknowledged; server work may already exist. Reconnect if needed, then retry preview with this unchanged draft, or check/retry the approved submission. Never create a replacement draft merely to retry.':
      'Yêu cầu chưa được xác nhận; công việc trên máy chủ có thể đã tồn tại. Kết nối lại nếu cần, rồi thử lại bản xem trước với bản nháp không đổi này, hoặc kiểm tra/gửi lại kế hoạch đã phê duyệt. Không tạo bản nháp thay thế chỉ để thử lại.',
    'The daemon refused this plan. Correct the settings and preview again.':
      'Daemon đã từ chối kế hoạch này. Hãy sửa các thiết lập rồi xem trước lại.',
    'Choose a dataset and model from this daemon first.':
      'Trước tiên hãy chọn bộ dữ liệu và mô hình từ daemon này.',
    'Selection or configuration is stale. Select again from the verified daemon.':
      'Lựa chọn hoặc cấu hình đã lỗi thời. Hãy chọn lại từ daemon đã xác minh.',
    'Review the validation errors before requesting a plan.':
      'Xem lại lỗi kiểm tra hợp lệ trước khi yêu cầu kế hoạch.',
    'Daemon acknowledged this exact plan.': 'Daemon đã tiếp nhận đúng kế hoạch này.',
    'Daemon reports {state}{submission}.': 'Daemon báo trạng thái {state}{submission}.',
    '; submission requested': '; đã yêu cầu gửi',
    '; not submitted yet': '; chưa gửi',
  },
);
