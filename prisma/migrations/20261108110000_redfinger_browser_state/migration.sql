-- Simpan identitas perangkat browser (terenkripsi) per login Redfinger.
-- AlterTable
ALTER TABLE "RedfingerLogin" ADD COLUMN     "browserStateEncrypted" TEXT;

