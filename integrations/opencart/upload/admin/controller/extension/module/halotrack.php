<?php
class ControllerExtensionModuleHalotrack extends Controller {
	private $error = array();

	public function index() {
		$this->load->language('extension/module/halotrack');

		$this->document->setTitle($this->language->get('heading_title'));

		$this->load->model('setting/setting');

		if (($this->request->server['REQUEST_METHOD'] == 'POST') && $this->validate()) {
			$this->model_setting_setting->editSetting('module_halotrack', $this->request->post);

			$this->session->data['success'] = $this->language->get('text_success');

			$this->response->redirect($this->url->link('marketplace/extension', 'user_token=' . $this->session->data['user_token'] . '&type=module', true));
		}

		$data['breadcrumbs'] = array();

		$data['breadcrumbs'][] = array(
			'text' => $this->language->get('text_home'),
			'href' => $this->url->link('common/dashboard', 'user_token=' . $this->session->data['user_token'], true)
		);

		$data['breadcrumbs'][] = array(
			'text' => $this->language->get('text_extension'),
			'href' => $this->url->link('marketplace/extension', 'user_token=' . $this->session->data['user_token'] . '&type=module', true)
		);

		$data['breadcrumbs'][] = array(
			'text' => $this->language->get('heading_title'),
			'href' => $this->url->link('extension/module/halotrack', 'user_token=' . $this->session->data['user_token'], true)
		);

		$data['error_warning'] = isset($this->error['warning']) ? $this->error['warning'] : '';

		$data['action'] = $this->url->link('extension/module/halotrack', 'user_token=' . $this->session->data['user_token'], true);
		$data['cancel'] = $this->url->link('marketplace/extension', 'user_token=' . $this->session->data['user_token'] . '&type=module', true);

		$fields = array(
			'module_halotrack_status'          => 0,
			'module_halotrack_url'             => '',
			'module_halotrack_secret'          => '',
			'module_halotrack_order_status_ids' => array(),
		);

		foreach ($fields as $key => $default) {
			if (isset($this->request->post[$key])) {
				$data[$key] = $this->request->post[$key];
			} else {
				$data[$key] = $this->config->get($key) !== null ? $this->config->get($key) : $default;
			}
		}

		$this->load->model('localisation/order_status');

		$data['order_statuses'] = $this->model_localisation_order_status->getOrderStatuses();

		$data['header'] = $this->load->controller('common/header');
		$data['column_left'] = $this->load->controller('common/column_left');
		$data['footer'] = $this->load->controller('common/footer');

		$this->response->setOutput($this->load->view('extension/module/halotrack', $data));
	}

	public function install() {
		$this->db->query("
			CREATE TABLE IF NOT EXISTS `" . DB_PREFIX . "order_halotrack` (
				`order_id` INT(11) NOT NULL,
				`session_id` VARCHAR(64) NULL,
				`customer_ip` VARCHAR(45) NULL,
				`forwarded_at` DATETIME NULL,
				PRIMARY KEY (`order_id`)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8
		");

		$this->load->model('setting/event');

		// startup/event.php strips everything up to and including the first
		// "/" before registering (substr($trigger, strpos($trigger, '/') + 1)),
		// so the leading "catalog/" segment here is required — without it,
		// the real fired event ("model/checkout/order/.../after") never matches.
		$this->model_setting_event->addEvent(
			'halotrack_order_created',
			'catalog/model/checkout/order/addOrder/after',
			'extension/module/halotrack/orderCreated'
		);

		$this->model_setting_event->addEvent(
			'halotrack_order_status_changed',
			'catalog/model/checkout/order/addOrderHistory/after',
			'extension/module/halotrack/orderStatusChanged'
		);
	}

	public function uninstall() {
		$this->load->model('setting/event');

		$this->model_setting_event->deleteEventByCode('halotrack_order_created');
		$this->model_setting_event->deleteEventByCode('halotrack_order_status_changed');

		// Deliberately not dropping oc_order_halotrack — preserves forwarding
		// history if the extension gets reinstalled.
	}

	protected function validate() {
		if (!$this->user->hasPermission('modify', 'extension/module/halotrack')) {
			$this->error['warning'] = $this->language->get('error_permission');
		}

		return !$this->error;
	}
}
