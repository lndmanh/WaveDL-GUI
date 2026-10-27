import { defineMessages } from './core';

export const storageMappingMessages = defineMessages(
  {
    title: 'Advanced: explicit storage mappings',
    guidance:
      'Host roots belong to the daemon host; execution roots belong to the selected Python execution environment. Mapping only rewrites paths lexically: it does not upload files, mount storage, resolve symlinks or verify access. Configure storage and site policy outside this form.',
    interpreter:
      'The interpreter path is an execution-realm path, not a host path to remap. Enter only mappings you explicitly configured; dataset and other draft paths are never changed by this editor.',
    local:
      'The local backend refuses nonempty storage mappings. Remove mappings or explicitly select your intended non-local backend; switching backends does not clear this draft.',
    empty: 'No mapping configured. Existing host-path behavior is unchanged.',
    host: 'Host root',
    execution: 'Execution root',
    row: 'Mapping {number}',
    add: 'Add mapping',
    remove: 'Remove mapping {number}',
    limit: 'Up to 32 explicit mappings. Each root is limited to 8192 characters.',
    rootError:
      'Enter an absolute root without parent traversal, control characters or invalid path syntax (8192 characters maximum).',
    rowError: 'Host and execution roots must use the same path platform.',
    mapError: 'Use no more than 32 mappings with unique host roots.',
  },
  {
    title: 'Nâng cao: ánh xạ lưu trữ rõ ràng',
    guidance:
      'Gốc máy chủ thuộc máy chạy daemon; gốc thực thi thuộc môi trường Python đã chọn. Ánh xạ chỉ thay thế đường dẫn theo cú pháp: không tải tệp lên, gắn bộ lưu trữ, phân giải liên kết tượng trưng hay xác minh quyền truy cập. Cấu hình lưu trữ và chính sách của hệ thống bên ngoài biểu mẫu này.',
    interpreter:
      'Đường dẫn trình thông dịch thuộc môi trường thực thi, không phải đường dẫn máy chủ để ánh xạ. Chỉ nhập ánh xạ bạn đã cấu hình rõ ràng; trình soạn thảo này không thay đổi đường dẫn dữ liệu hay các đường dẫn khác trong bản nháp.',
    local:
      'Backend cục bộ từ chối ánh xạ lưu trữ không rỗng. Xóa ánh xạ hoặc chủ động chọn backend không cục bộ phù hợp; chuyển backend không xóa bản nháp này.',
    empty: 'Chưa cấu hình ánh xạ. Cách xử lý đường dẫn máy chủ hiện tại không thay đổi.',
    host: 'Gốc máy chủ',
    execution: 'Gốc thực thi',
    row: 'Ánh xạ {number}',
    add: 'Thêm ánh xạ',
    remove: 'Xóa ánh xạ {number}',
    limit: 'Tối đa 32 ánh xạ rõ ràng. Mỗi gốc giới hạn 8192 ký tự.',
    rootError:
      'Nhập gốc tuyệt đối không chứa truy ngược thư mục cha, ký tự điều khiển hay cú pháp đường dẫn không hợp lệ (tối đa 8192 ký tự).',
    rowError: 'Gốc máy chủ và gốc thực thi phải dùng cùng nền tảng đường dẫn.',
    mapError: 'Dùng tối đa 32 ánh xạ với các gốc máy chủ không trùng nhau.',
  },
);
