/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOnboardingService } from '../common/onboardingService.js';

// Kairu: replaced Copilot-dependent OnboardingVariationA with a no-op.
// A Kairu-native welcome experience will be added in Phase 10.
class KairuOnboardingService extends Disposable implements IOnboardingService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

	show(): void {
		// no-op — Kairu welcome experience coming in Phase 10
	}
}

registerSingleton(IOnboardingService, KairuOnboardingService, InstantiationType.Delayed);
