import { clientMessages, translateClientMessage } from '../i18n/client-messages';
import { useWorkstationI18n } from './useWorkstationI18n';

/** Use only at client-diagnostic render boundaries, never for daemon logs/details. */
export function useClientMessages() {
  const { locale } = useWorkstationI18n(clientMessages);
  return {
    clientMessage: (rawEnglish: string): string => translateClientMessage(locale.value, rawEnglish),
  };
}
