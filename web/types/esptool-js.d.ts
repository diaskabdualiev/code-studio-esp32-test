declare module "esptool-js" {
  export class Transport {
    constructor(port: SerialPort, openOrReset?: boolean, tracing?: boolean);
    disconnect(): Promise<void>;
  }

  export type FlashFile = {
    address: number;
    data: Uint8Array | ArrayBuffer | string;
  };

  export class ESPLoader {
    constructor(options: {
      transport: Transport;
      baudrate: number;
      terminal?: unknown;
      debugLogging?: boolean;
    });

    main(): Promise<void>;

    writeFlash(options: {
      fileArray: FlashFile[];
      flashSize?: string;
      flashMode?: string;
      flashFreq?: string;
      eraseAll?: boolean;
      compress?: boolean;
      reportProgress?: (fileIndex: number, written: number, total: number) => void;
      calculateMD5Hash?: boolean;
    }): Promise<void>;

    after(mode?: string): Promise<void>;
  }
}
