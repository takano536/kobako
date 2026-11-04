import { CardFormSkeleton, CARD_FORM_RECIPES } from '../../../../../_components/card-skeleton';

export default function Loading() {
  const recipe = CARD_FORM_RECIPES.transferEdit;
  return <CardFormSkeleton label="取引を読み込み中" {...recipe} />;
}
