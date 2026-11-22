import { Decoder, Stream } from '@garmin/fitsdk';

/** Message FIT décodé, manipulé de façon souple (les champs varient selon les montres). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FitMesg = Record<string, any>;
export type FitMessages = Record<string, FitMesg[] | undefined>;

export class FitDecodeError extends Error {}

/** Décode un fichier FIT. Les messages de profil utilisateur (poids, sommeil…) sont supprimés. */
export function decodeFit(bytes: Uint8Array): FitMessages {
  // slice() copie les octets dans un ArrayBuffer propre (sans décalage).
  const stream = Stream.fromArrayBuffer(bytes.slice().buffer);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new FitDecodeError("Ce fichier n'est pas un fichier FIT valide.");
  if (!decoder.checkIntegrity()) throw new FitDecodeError('Fichier FIT corrompu (contrôle d’intégrité échoué).');

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: false,
    mergeHeartRates: true,
  });
  if (errors.length && !messages.sessionMesgs?.length) {
    throw new FitDecodeError(`Erreur de décodage : ${errors[0].message}`);
  }
  // Confidentialité : on ne garde aucune donnée de santé générale.
  const out = { ...(messages as unknown as FitMessages) };
  delete out.userProfileMesgs;
  delete out.hrvMesgs;
  delete out.monitoringMesgs;
  return out;
}
