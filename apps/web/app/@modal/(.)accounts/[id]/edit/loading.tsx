import { CardFormSkeleton, CARD_FORM_RECIPES } from '../../../../_components/card-skeleton';

export default function Loading() {
  const recipe = CARD_FORM_RECIPES.accountEdit;
  return <CardFormSkeleton label="資産を読み込み中" {...recipe} />;
}
